import type { Job } from 'bullmq';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Video, VideoStatus } from './entities/video.entity';
import { originalVideoKey, thumbnailKey } from './videos.constants';
import { VideoProcessingWorker } from './video-processing.worker';

const ALL_ENTITIES = [User, Channel, Video];
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample.mp4');

describe('VideoProcessingWorker (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let uploadedThumbnails: Map<string, Buffer>;
  let storageService: {
    downloadToFile: jest.Mock;
    uploadFile: jest.Mock;
  };
  let worker: VideoProcessingWorker;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    uploadedThumbnails = new Map();
    storageService = {
      downloadToFile: jest
        .fn()
        .mockImplementation(async (_key: string, destPath: string) => {
          await copyFile(FIXTURE_PATH, destPath);
        }),
      uploadFile: jest
        .fn()
        .mockImplementation(async (key: string, sourcePath: string) => {
          uploadedThumbnails.set(key, await readFile(sourcePath));
        }),
    };
    worker = new VideoProcessingWorker(videoRepository, storageService as any);
  });

  let userCounter = 0;
  async function createVideo(overrides: Partial<Video> = {}): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `worker_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Channel',
        nickname: `worker_chan_${userCounter}`,
        user_id: user.id,
      }),
    );
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        status: VideoStatus.PROCESSING,
        ...overrides,
      }),
    );
  }

  function makeJob(videoId: string): Job<{ videoId: string }> {
    return { data: { videoId } } as Job<{ videoId: string }>;
  }

  it('extrai duration/metadata via ffprobe, gera thumbnail via ffmpeg e transiciona status para ready', async () => {
    const video = await createVideo();

    await worker.process(makeJob(video.id));

    const updated = await videoRepository.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.READY);
    expect(updated.duration).toBeGreaterThanOrEqual(1);
    expect(updated.metadata).toBeTruthy();
    expect(updated.metadata?.format).toBeDefined();

    expect(storageService.downloadToFile).toHaveBeenCalledWith(
      originalVideoKey(video.id),
      expect.any(String),
    );
    const thumbnail = uploadedThumbnails.get(thumbnailKey(video.id));
    expect(thumbnail).toBeDefined();
    expect((thumbnail as Buffer).length).toBeGreaterThan(0);
  }, 30000);

  it('nao reprocessa um video que ja esta ready (idempotencia)', async () => {
    const video = await createVideo({ status: VideoStatus.READY });

    await worker.process(makeJob(video.id));

    expect(storageService.downloadToFile).not.toHaveBeenCalled();
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });
});
