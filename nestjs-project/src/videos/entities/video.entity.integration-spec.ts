import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

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
  });

  let userCounter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `vid_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: 'Channel',
        nickname: `chan_${userCounter}`,
        user_id: user.id,
      }),
    );
  }

  it('should persist with default status "draft" when status is not provided', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({ channel_id: channel.id }),
    );

    expect(video.status).toBe(VideoStatus.DRAFT);
  });

  it('should violate the FK constraint when channel_id does not exist', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should reject a status outside the allowed enum values', async () => {
    const channel = await createChannel();

    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("channel_id", "status") VALUES ($1, $2)`,
        [channel.id, 'not_a_real_status'],
      ),
    ).rejects.toThrow();
  });

  it('should update updated_at on every status transition', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({ channel_id: channel.id }),
    );
    const originalUpdatedAt = video.updated_at;

    await new Promise((resolve) => setTimeout(resolve, 10));
    video.status = VideoStatus.UPLOADING;
    const updated = await videoRepository.save(video);

    expect(updated.updated_at.getTime()).toBeGreaterThan(
      originalUpdatedAt.getTime(),
    );
  });
});
