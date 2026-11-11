import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

interface LoginResponseBody {
  access_token: string;
}

interface VideoDetailResponseBody {
  status: string;
  duration: number | null;
  streamUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
}

interface ErrorResponseBody {
  error: string;
}

describe('videos-detail', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: {
    getPresignedGetUrl: jest.Mock;
  };

  beforeAll(async () => {
    storageService = {
      getPresignedGetUrl: jest
        .fn()
        .mockImplementation(
          (key: string, options?: { disposition?: string }) => {
            if (key.endsWith('thumbnail.jpg')) {
              return 'https://signed.example/thumbnail';
            }
            if (options?.disposition) {
              return 'https://signed.example/download';
            }
            return 'https://signed.example/stream';
          },
        ),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storageService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
  });

  let counter = 0;
  async function registerConfirmLoginWithChannel(): Promise<{
    accessToken: string;
    channelId: string;
  }> {
    const email = `video_detail_user_${++counter}@example.com`;
    const password = 'password123';

    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as { mailService: MailService }
    ).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        capturedToken = t;
        return Promise.resolve();
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });

    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    const loginBody = loginRes.body as LoginResponseBody;

    const user = await userRepository.findOneByOrFail({ email });
    const channel = await channelRepository.findOneByOrFail({
      user_id: user.id,
    });

    return {
      accessToken: loginBody.access_token,
      channelId: channel.id,
    };
  }

  async function createVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    return videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        status: VideoStatus.UPLOADING,
        upload_id: 'mock-upload-id',
        ...overrides,
      }),
    );
  }

  // Group 1: Detalhe do vídeo por status
  it('retorna-detalhe-sem-urls-durante-processamento: returns 200 with status processing and no signed URLs', async () => {
    const { accessToken, channelId } = await registerConfirmLoginWithChannel();
    const video = await createVideo(channelId, {
      status: VideoStatus.PROCESSING,
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as VideoDetailResponseBody;

    expect(body.status).toBe('processing');
    expect(body.streamUrl).toBeNull();
    expect(body.downloadUrl).toBeNull();
    expect(body.thumbnailUrl).toBeNull();
  });

  it('retorna-urls-assinadas-quando-pronto: returns 200 with status ready, duration and signed URLs', async () => {
    const { accessToken, channelId } = await registerConfirmLoginWithChannel();
    const video = await createVideo(channelId, {
      status: VideoStatus.READY,
      duration: 120,
      metadata: { width: 1920, height: 1080 },
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as VideoDetailResponseBody;

    expect(body.status).toBe('ready');
    expect(body.duration).toBe(120);
    expect(body.streamUrl).toBe('https://signed.example/stream');
    expect(body.downloadUrl).toBe('https://signed.example/download');
    expect(body.thumbnailUrl).toBe('https://signed.example/thumbnail');
  });

  // Group 2: Autorização por canal
  it('nega-acesso-a-video-inexistente-ou-de-outro-canal: returns 404 VIDEO_NOT_FOUND for a missing or foreign video', async () => {
    const channelA = await registerConfirmLoginWithChannel();
    const channelB = await registerConfirmLoginWithChannel();

    const missingRes = await request(app.getHttpServer())
      .get('/videos/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${channelA.accessToken}`)
      .expect(404);
    expect((missingRes.body as ErrorResponseBody).error).toBe(
      'VIDEO_NOT_FOUND',
    );

    const video = await createVideo(channelA.channelId);
    const foreignRes = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .set('Authorization', `Bearer ${channelB.accessToken}`)
      .expect(404);
    expect((foreignRes.body as ErrorResponseBody).error).toBe(
      'VIDEO_NOT_FOUND',
    );
  });
});
