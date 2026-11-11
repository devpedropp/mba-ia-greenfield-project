import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
  bucket: process.env.STORAGE_BUCKET || 'streamtube',
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
  signedUrlExpirationSeconds: parseInt(
    process.env.STORAGE_SIGNED_URL_EXPIRATION_SECONDS || '3600',
    10,
  ),
}));
