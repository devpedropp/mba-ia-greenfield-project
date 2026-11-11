import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidUploadStateException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { StorageService, UploadPart } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { originalVideoKey } from './videos.constants';
import { VideoQueueProducer } from './video-queue.producer';

export interface CreateDraftResult {
  id: string;
  status: VideoStatus;
  uploadId: string;
  key: string;
}

@Injectable()
export class UploadSessionService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly videoQueueProducer: VideoQueueProducer,
    private readonly channelsService: ChannelsService,
  ) {}

  private keyFor(videoId: string): string {
    return originalVideoKey(videoId);
  }

  async createDraft(userId: string): Promise<CreateDraftResult> {
    const channel = await this.channelsService.findByUserId(userId);
    const video = await this.videoRepository.save(
      this.videoRepository.create({ channel_id: channel.id }),
    );

    const key = this.keyFor(video.id);
    const uploadId = await this.storageService.createMultipartUpload(key);
    video.upload_id = uploadId;
    await this.videoRepository.save(video);

    return { id: video.id, status: video.status, uploadId, key };
  }

  private async findOwnedVideoInUploadState(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    const video = await this.videoRepository.findOne({
      where: { id: videoId, channel_id: channel.id },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (
      video.status !== VideoStatus.DRAFT &&
      video.status !== VideoStatus.UPLOADING
    ) {
      throw new InvalidUploadStateException();
    }
    return video;
  }

  async signPart(
    userId: string,
    videoId: string,
    params: { uploadId: string; partNumber: number },
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    const video = await this.findOwnedVideoInUploadState(userId, videoId);
    return this.storageService.signPartUrl({
      key: this.keyFor(video.id),
      uploadId: params.uploadId,
      partNumber: params.partNumber,
    });
  }

  async listParts(
    userId: string,
    videoId: string,
    uploadId: string,
  ): Promise<UploadPart[]> {
    const video = await this.findOwnedVideoInUploadState(userId, videoId);
    return this.storageService.listParts({
      key: this.keyFor(video.id),
      uploadId,
    });
  }

  async completeUpload(
    userId: string,
    videoId: string,
    params: { uploadId: string; parts: UploadPart[] },
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.findOwnedVideoInUploadState(userId, videoId);
    await this.storageService.completeMultipartUpload({
      key: this.keyFor(video.id),
      uploadId: params.uploadId,
      parts: params.parts,
    });

    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);
    await this.videoQueueProducer.enqueueProcessing(video.id);

    return { id: video.id, status: video.status };
  }

  async abortUpload(
    userId: string,
    videoId: string,
    uploadId: string,
  ): Promise<void> {
    const video = await this.findOwnedVideoInUploadState(userId, videoId);
    await this.storageService.abortMultipartUpload({
      key: this.keyFor(video.id),
      uploadId,
    });
  }
}
