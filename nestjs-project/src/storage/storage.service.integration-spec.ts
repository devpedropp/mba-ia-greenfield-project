import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
  });

  function uniqueKey(): string {
    return `videos/${crypto.randomUUID()}/original.mp4`;
  }

  it('createMultipartUpload should return a valid uploadId', async () => {
    const uploadId = await storageService.createMultipartUpload(uniqueKey());

    expect(typeof uploadId).toBe('string');
    expect(uploadId.length).toBeGreaterThan(0);
  });

  it('signPartUrl should return a URL that accepts a direct PUT to the storage backend', async () => {
    const key = uniqueKey();
    const uploadId = await storageService.createMultipartUpload(key);
    const body = Buffer.from('hello world');

    const { url } = await storageService.signPartUrl({
      key,
      uploadId,
      partNumber: 1,
    });
    const response = await fetch(url, { method: 'PUT', body });

    expect(response.ok).toBe(true);
    expect(response.headers.get('etag')).toBeTruthy();

    await storageService.abortMultipartUpload({ key, uploadId });
  });

  it('listParts should reflect parts already uploaded for an in-progress uploadId', async () => {
    const key = uniqueKey();
    const uploadId = await storageService.createMultipartUpload(key);
    const body = Buffer.from('hello world');
    const { url } = await storageService.signPartUrl({
      key,
      uploadId,
      partNumber: 1,
    });
    const putResponse = await fetch(url, { method: 'PUT', body });
    const etag = putResponse.headers.get('etag') as string;

    const parts = await storageService.listParts({ key, uploadId });

    expect(parts).toEqual([{ partNumber: 1, ETag: etag }]);

    await storageService.abortMultipartUpload({ key, uploadId });
  });

  it('completeMultipartUpload should finalize the object and make it recoverable via getPresignedGetUrl', async () => {
    const key = uniqueKey();
    const uploadId = await storageService.createMultipartUpload(key);
    const body = Buffer.from('hello world');
    const { url } = await storageService.signPartUrl({
      key,
      uploadId,
      partNumber: 1,
    });
    const putResponse = await fetch(url, { method: 'PUT', body });
    const etag = putResponse.headers.get('etag') as string;

    await storageService.completeMultipartUpload({
      key,
      uploadId,
      parts: [{ partNumber: 1, ETag: etag }],
    });

    const getUrl = await storageService.getPresignedGetUrl(key);
    const getResponse = await fetch(getUrl);

    expect(getResponse.ok).toBe(true);
    expect(await getResponse.text()).toBe('hello world');
  });

  it('abortMultipartUpload should discard an in-progress upload', async () => {
    const key = uniqueKey();
    const uploadId = await storageService.createMultipartUpload(key);

    await expect(
      storageService.abortMultipartUpload({ key, uploadId }),
    ).resolves.not.toThrow();
  });
});
