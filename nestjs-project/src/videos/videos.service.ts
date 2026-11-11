import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { originalVideoKey, thumbnailKey } from './videos.constants';

export interface VideoDetail {
  id: string;
  status: VideoStatus;
  duration: number | null;
  streamUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
  ) {}

  async getById(userId: string, videoId: string): Promise<VideoDetail> {
    const channel = await this.channelsService.findByUserId(userId);
    const video = await this.videoRepository.findOne({
      where: { id: videoId, channel_id: channel.id },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const [streamUrl, downloadUrl, thumbnailUrl] =
      video.status === VideoStatus.READY
        ? await Promise.all([
            this.storageService.getPresignedGetUrl(originalVideoKey(video.id)),
            this.storageService.getPresignedGetUrl(originalVideoKey(video.id), {
              disposition: 'attachment',
            }),
            this.storageService.getPresignedGetUrl(thumbnailKey(video.id)),
          ])
        : [null, null, null];

    return {
      id: video.id,
      status: video.status,
      duration: video.duration,
      streamUrl,
      downloadUrl,
      thumbnailUrl,
    };
  }
}
