import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsModule } from '../channels/channels.module';
import { Channel } from '../channels/entities/channel.entity';
import {
  InvalidUploadStateException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { UploadSessionService } from './upload-session.service';
import { VideoQueueProducer } from './video-queue.producer';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

function makeStorageServiceMock() {
  return {
    createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
    signPartUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://signed.example/part' }),
    listParts: jest.fn().mockResolvedValue([]),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
  };
}

describe('UploadSessionService (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let uploadSessionService: UploadSessionService;
  let storageService: ReturnType<typeof makeStorageServiceMock>;
  let queueProducer: { enqueueProcessing: jest.Mock };

  beforeAll(async () => {
    storageService = makeStorageServiceMock();
    queueProducer = {
      enqueueProcessing: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
        ChannelsModule,
      ],
      providers: [
        UploadSessionService,
        { provide: StorageService, useValue: storageService },
        { provide: VideoQueueProducer, useValue: queueProducer },
      ],
    }).compile();

    dataSource = module.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    uploadSessionService = module.get(UploadSessionService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
  });

  let counter = 0;
  async function createUserWithChannel(): Promise<{
    userId: string;
    channelId: string;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `upload_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Channel',
        nickname: `upload_chan_${counter}`,
        user_id: user.id,
      }),
    );
    return { userId: user.id, channelId: channel.id };
  }

  describe('createDraft', () => {
    it('should persist a draft Video row owned by the caller channel', async () => {
      const { userId, channelId } = await createUserWithChannel();

      const result = await uploadSessionService.createDraft(userId);

      const saved = await videoRepository.findOneBy({ id: result.id });
      expect(saved?.channel_id).toBe(channelId);
      expect(saved?.status).toBe(VideoStatus.DRAFT);
      expect(saved?.upload_id).toBe('upload-id');
    });
  });

  describe('ownership scoping', () => {
    it('should throw VideoNotFoundException when the video belongs to a different channel', async () => {
      const ownerChannel = await createUserWithChannel();
      const otherUser = await createUserWithChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: ownerChannel.channelId,
          status: VideoStatus.UPLOADING,
          upload_id: 'upload-id',
        }),
      );

      await expect(
        uploadSessionService.signPart(otherUser.userId, video.id, {
          uploadId: 'upload-id',
          partNumber: 1,
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should throw InvalidUploadStateException when status is outside draft/uploading', async () => {
      const { userId, channelId } = await createUserWithChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channelId,
          status: VideoStatus.READY,
          upload_id: 'upload-id',
        }),
      );

      await expect(
        uploadSessionService.signPart(userId, video.id, {
          uploadId: 'upload-id',
          partNumber: 1,
        }),
      ).rejects.toThrow(InvalidUploadStateException);
    });
  });

  describe('completeUpload', () => {
    it('should persist status "processing" and enqueue the processing job', async () => {
      const { userId, channelId } = await createUserWithChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channelId,
          status: VideoStatus.UPLOADING,
          upload_id: 'upload-id',
        }),
      );

      await uploadSessionService.completeUpload(userId, video.id, {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, ETag: 'etag-1' }],
      });

      const saved = await videoRepository.findOneBy({ id: video.id });
      expect(saved?.status).toBe(VideoStatus.PROCESSING);
      expect(queueProducer.enqueueProcessing).toHaveBeenCalledWith(video.id);
    });
  });
});
