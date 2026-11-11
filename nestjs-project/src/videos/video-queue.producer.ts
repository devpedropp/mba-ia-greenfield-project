import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { VIDEO_PROCESS_JOB, VIDEO_PROCESSING_QUEUE } from './videos.constants';

@Injectable()
export class VideoQueueProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueProcessing(videoId: string): Promise<void> {
    await this.queue.add(VIDEO_PROCESS_JOB, { videoId });
  }
}
