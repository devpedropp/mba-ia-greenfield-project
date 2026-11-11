import type { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidUploadStateException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { UploadSessionService } from './upload-session.service';
import { VideoQueueProducer } from './video-queue.producer';

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-id';
  video.channel_id = 'channel-id';
  video.status = VideoStatus.DRAFT;
  video.upload_id = null;
  video.duration = null;
  video.metadata = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  Object.assign(video, overrides);
  return video;
}

interface MockVideoRepo {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
}

function makeRepo(overrides: Partial<MockVideoRepo> = {}): MockVideoRepo {
  return {
    create: jest.fn((partial: Partial<Video>) => makeVideo(partial)),
    save: jest.fn((video: Video) => Promise.resolve(video)),
    findOne: jest.fn(),
    ...overrides,
  };
}

interface MockStorageService {
  createMultipartUpload: jest.Mock;
  signPartUrl: jest.Mock;
  listParts: jest.Mock;
  completeMultipartUpload: jest.Mock;
  abortMultipartUpload: jest.Mock;
}

function makeStorageService(
  overrides: Partial<MockStorageService> = {},
): MockStorageService {
  return {
    createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
    signPartUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://signed.example/part' }),
    listParts: jest.fn().mockResolvedValue([]),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface MockQueueProducer {
  enqueueProcessing: jest.Mock;
}

function makeQueueProducer(): MockQueueProducer {
  return { enqueueProcessing: jest.fn().mockResolvedValue(undefined) };
}

interface MockChannelsService {
  findByUserId: jest.Mock;
}

function makeChannelsService(channelId = 'channel-id'): MockChannelsService {
  return {
    findByUserId: jest.fn().mockResolvedValue({ id: channelId }),
  };
}

function makeService(
  repo: MockVideoRepo,
  storage: MockStorageService,
  queueProducer: MockQueueProducer,
  channelsService: MockChannelsService,
): UploadSessionService {
  return new UploadSessionService(
    repo as unknown as Repository<Video>,
    storage as unknown as StorageService,
    queueProducer as unknown as VideoQueueProducer,
    channelsService as unknown as ChannelsService,
  );
}

describe('UploadSessionService', () => {
  describe('createDraft', () => {
    it('should create a draft video, initiate the multipart upload, and return id/status/uploadId/key', async () => {
      const repo = makeRepo();
      const storage = makeStorageService();
      const service = makeService(
        repo,
        storage,
        makeQueueProducer(),
        makeChannelsService('channel-id'),
      );

      const result = await service.createDraft('user-id');

      expect(repo.create).toHaveBeenCalledWith({ channel_id: 'channel-id' });
      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        'videos/video-id/original.mp4',
      );
      expect(result).toEqual({
        id: 'video-id',
        status: VideoStatus.DRAFT,
        uploadId: 'upload-id',
        key: 'videos/video-id/original.mp4',
      });
    });
  });

  describe('signPart', () => {
    it('should sign a part for a video in draft/uploading state', async () => {
      const repo = makeRepo({
        findOne: jest
          .fn()
          .mockResolvedValue(makeVideo({ status: VideoStatus.UPLOADING })),
      });
      const storage = makeStorageService();
      const service = makeService(
        repo,
        storage,
        makeQueueProducer(),
        makeChannelsService(),
      );

      const result = await service.signPart('user-id', 'video-id', {
        uploadId: 'upload-id',
        partNumber: 1,
      });

      expect(storage.signPartUrl).toHaveBeenCalledWith({
        key: 'videos/video-id/original.mp4',
        uploadId: 'upload-id',
        partNumber: 1,
      });
      expect(result).toEqual({ url: 'https://signed.example/part' });
    });

    it('should throw VideoNotFoundException when the video does not belong to the channel', async () => {
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      const service = makeService(
        repo,
        makeStorageService(),
        makeQueueProducer(),
        makeChannelsService(),
      );

      await expect(
        service.signPart('user-id', 'video-id', {
          uploadId: 'u',
          partNumber: 1,
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should throw InvalidUploadStateException when status is not draft/uploading', async () => {
      const repo = makeRepo({
        findOne: jest
          .fn()
          .mockResolvedValue(makeVideo({ status: VideoStatus.READY })),
      });
      const service = makeService(
        repo,
        makeStorageService(),
        makeQueueProducer(),
        makeChannelsService(),
      );

      await expect(
        service.signPart('user-id', 'video-id', {
          uploadId: 'u',
          partNumber: 1,
        }),
      ).rejects.toThrow(InvalidUploadStateException);
    });
  });

  describe('listParts', () => {
    it('should return the parts reported by StorageService for an in-progress upload', async () => {
      const repo = makeRepo({
        findOne: jest
          .fn()
          .mockResolvedValue(makeVideo({ status: VideoStatus.UPLOADING })),
      });
      const storage = makeStorageService({
        listParts: jest
          .fn()
          .mockResolvedValue([{ partNumber: 1, ETag: 'etag-1' }]),
      });
      const service = makeService(
        repo,
        storage,
        makeQueueProducer(),
        makeChannelsService(),
      );

      const parts = await service.listParts('user-id', 'video-id', 'upload-id');

      expect(storage.listParts).toHaveBeenCalledWith({
        key: 'videos/video-id/original.mp4',
        uploadId: 'upload-id',
      });
      expect(parts).toEqual([{ partNumber: 1, ETag: 'etag-1' }]);
    });
  });

  describe('completeUpload', () => {
    it('should complete the multipart upload, transition status to processing, and enqueue the job', async () => {
      const video = makeVideo({ status: VideoStatus.UPLOADING });
      const repo = makeRepo({ findOne: jest.fn().mockResolvedValue(video) });
      const storage = makeStorageService();
      const queueProducer = makeQueueProducer();
      const service = makeService(
        repo,
        storage,
        queueProducer,
        makeChannelsService(),
      );

      const result = await service.completeUpload('user-id', 'video-id', {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, ETag: 'etag-1' }],
      });

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith({
        key: 'videos/video-id/original.mp4',
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, ETag: 'etag-1' }],
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: VideoStatus.PROCESSING }),
      );
      expect(queueProducer.enqueueProcessing).toHaveBeenCalledWith('video-id');
      expect(result).toEqual({
        id: 'video-id',
        status: VideoStatus.PROCESSING,
      });
    });
  });

  describe('abortUpload', () => {
    it('should abort the multipart upload for an in-progress video', async () => {
      const repo = makeRepo({
        findOne: jest
          .fn()
          .mockResolvedValue(makeVideo({ status: VideoStatus.UPLOADING })),
      });
      const storage = makeStorageService();
      const service = makeService(
        repo,
        storage,
        makeQueueProducer(),
        makeChannelsService(),
      );

      await service.abortUpload('user-id', 'video-id', 'upload-id');

      expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
        key: 'videos/video-id/original.mp4',
        uploadId: 'upload-id',
      });
    });
  });
});
