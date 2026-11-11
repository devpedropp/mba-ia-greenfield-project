import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { STORAGE_S3_CLIENT } from './storage.constants';

export interface SignedUrlResult {
  url: string;
  headers?: Record<string, string>;
}

export interface UploadPart {
  partNumber: number;
  ETag: string;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async createMultipartUpload(key: string): Promise<string> {
    const result = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
    if (!result.UploadId) {
      throw new Error(
        `Object storage did not return an UploadId for key "${key}"`,
      );
    }
    return result.UploadId;
  }

  async signPartUrl(params: {
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<SignedUrlResult> {
    const url = await getSignedUrl(
      this.s3Client,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
      }),
      { expiresIn: this.config.signedUrlExpirationSeconds },
    );
    return { url };
  }

  async listParts(params: {
    key: string;
    uploadId: string;
  }): Promise<UploadPart[]> {
    const result = await this.s3Client.send(
      new ListPartsCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );
    return (result.Parts ?? []).map((part) => ({
      partNumber: part.PartNumber as number,
      ETag: part.ETag as string,
    }));
  }

  async completeMultipartUpload(params: {
    key: string;
    uploadId: string;
    parts: UploadPart[];
  }): Promise<void> {
    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: params.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.ETag,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(params: {
    key: string;
    uploadId: string;
  }): Promise<void> {
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const result = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    await pipeline(result.Body as Readable, createWriteStream(destPath));
  }

  async uploadFile(
    key: string,
    sourcePath: string,
    options: { contentType?: string } = {},
  ): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ...(options.contentType && { ContentType: options.contentType }),
      }),
    );
  }

  async getPresignedGetUrl(
    key: string,
    options: { disposition?: string } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(options.disposition && {
          ResponseContentDisposition: options.disposition,
        }),
      }),
      { expiresIn: this.config.signedUrlExpirationSeconds },
    );
  }
}
