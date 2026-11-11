import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import {
  originalVideoKey,
  thumbnailKey,
  VIDEO_PROCESSING_QUEUE,
} from './videos.constants';

export interface VideoProcessJobData {
  videoId: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  [key: string]: unknown;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });
  });
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingWorker extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingWorker.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videoRepository.findOneByOrFail({
      id: videoId,
    });

    if (video.status === VideoStatus.READY) {
      this.logger.log(`Video ${videoId} is already ready, skipping`);
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), `video-${videoId}-`));
    const inputPath = join(workDir, 'original.mp4');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      await this.storageService.downloadToFile(
        originalVideoKey(videoId),
        inputPath,
      );

      const metadata = await this.extractMetadata(inputPath);
      const duration = Math.round(
        parseFloat(metadata?.format?.duration ?? '0'),
      );

      await this.generateThumbnail(inputPath, thumbnailPath);
      await this.storageService.uploadFile(
        thumbnailKey(videoId),
        thumbnailPath,
        { contentType: 'image/jpeg' },
      );

      video.duration = duration;
      video.metadata = metadata;
      video.status = VideoStatus.READY;
      await this.videoRepository.save(video);
    } catch (error) {
      this.logger.error(
        `Failed to process video ${videoId}: ${(error as Error).message}`,
      );
      video.status = VideoStatus.FAILED;
      await this.videoRepository.save(video);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async extractMetadata(inputPath: string): Promise<FfprobeOutput> {
    const stdout = await runCommand('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
  }

  private async generateThumbnail(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    await runCommand('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ss',
      '00:00:01',
      '-vframes',
      '1',
      outputPath,
    ]);
  }
}
