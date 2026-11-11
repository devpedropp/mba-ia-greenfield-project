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
import { VideoQueueProducer } from '../src/videos/video-queue.producer';

interface LoginResponseBody {
  access_token: string;
}

interface CreateDraftResponseBody {
  id: string;
  status: string;
  uploadId: string;
  key: string;
}

interface SignPartResponseBody {
  url: string;
}

interface ListPartsResponseBody {
  parts: Array<{ partNumber: number; ETag: string }>;
}

interface CompleteResponseBody {
  status: string;
}

interface ErrorResponseBody {
  error: string;
}

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: {
    createMultipartUpload: jest.Mock;
    signPartUrl: jest.Mock;
    listParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
  };
  let queueProducer: VideoQueueProducer;

  beforeAll(async () => {
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('mock-upload-id'),
      signPartUrl: jest
        .fn()
        .mockResolvedValue({ url: 'https://signed.example/part-1' }),
      listParts: jest.fn().mockResolvedValue([]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
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
    queueProducer = moduleFixture.get(VideoQueueProducer);
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
    const email = `video_user_${++counter}@example.com`;
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

  describe('POST /videos', () => {
    it('cria-draft-e-inicia-multipart-upload: returns 201 with id, status draft, uploadId and key', async () => {
      const { accessToken } = await registerConfirmLoginWithChannel();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      const body = res.body as CreateDraftResponseBody;

      expect(body.id).toBeDefined();
      expect(body.status).toBe('draft');
      expect(body.uploadId).toBe('mock-upload-id');
      expect(body.key).toBe(`videos/${body.id}/original.mp4`);
    });
  });

  describe('POST /videos/:id/parts/sign', () => {
    it('assina-url-para-parte-valida: returns 200 with url for a video in status uploading', async () => {
      const { accessToken, channelId } =
        await registerConfirmLoginWithChannel();
      const video = await createVideo(channelId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/parts/sign`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ method: 'PUT', uploadId: video.upload_id, partNumber: 1 })
        .expect(200);

      expect((res.body as SignPartResponseBody).url).toBe(
        'https://signed.example/part-1',
      );
    });

    it('rejeita-assinatura-fora-do-estado-uploading: returns 409 INVALID_UPLOAD_STATE for a ready video', async () => {
      const { accessToken, channelId } =
        await registerConfirmLoginWithChannel();
      const video = await createVideo(channelId, { status: VideoStatus.READY });

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/parts/sign`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ method: 'PUT', uploadId: video.upload_id, partNumber: 1 })
        .expect(409);

      expect((res.body as ErrorResponseBody).error).toBe(
        'INVALID_UPLOAD_STATE',
      );
    });
  });

  describe('GET /videos/:id/parts', () => {
    it('lista-partes-ja-enviadas: returns 200 with the parts already uploaded', async () => {
      const { accessToken, channelId } =
        await registerConfirmLoginWithChannel();
      const video = await createVideo(channelId);
      storageService.listParts.mockResolvedValueOnce([
        { partNumber: 1, ETag: 'etag-1' },
        { partNumber: 2, ETag: 'etag-2' },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}/parts`)
        .query({ uploadId: video.upload_id })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((res.body as ListPartsResponseBody).parts).toEqual([
        { partNumber: 1, ETag: 'etag-1' },
        { partNumber: 2, ETag: 'etag-2' },
      ]);
    });
  });

  describe('POST /videos/:id/complete', () => {
    it('completa-upload-e-enfileira-processamento: returns 200 with status processing and enqueues the job', async () => {
      const { accessToken, channelId } =
        await registerConfirmLoginWithChannel();
      const video = await createVideo(channelId);
      const enqueueSpy = jest.spyOn(queueProducer, 'enqueueProcessing');

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          uploadId: video.upload_id,
          parts: [{ partNumber: 1, ETag: 'etag-1' }],
        })
        .expect(200);

      expect((res.body as CompleteResponseBody).status).toBe('processing');
      expect(enqueueSpy).toHaveBeenCalledWith(video.id);
    });
  });

  describe('POST /videos/:id/abort', () => {
    it('aborta-sessao-de-upload: returns 204 with no body', async () => {
      const { accessToken, channelId } =
        await registerConfirmLoginWithChannel();
      const video = await createVideo(channelId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/abort`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ uploadId: video.upload_id })
        .expect(204);

      expect(res.body).toEqual({});
    });
  });

  describe('Autorização por canal', () => {
    it('nega-acesso-a-video-de-outro-canal: returns 404 VIDEO_NOT_FOUND when video belongs to another channel', async () => {
      const channelA = await registerConfirmLoginWithChannel();
      const channelB = await registerConfirmLoginWithChannel();
      const video = await createVideo(channelA.channelId);

      const res = await request(app.getHttpServer())
        .post(`/videos/${video.id}/parts/sign`)
        .set('Authorization', `Bearer ${channelB.accessToken}`)
        .send({ method: 'PUT', uploadId: video.upload_id, partNumber: 1 })
        .expect(404);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
