import './video-queue-backend';

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { ConnectionOptions } from 'bullmq';
import { ChannelsModule } from '../channels/channels.module';
import databaseConfig from '../config/database.config';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { UploadSessionService } from './upload-session.service';
import { VideoProcessingWorker } from './video-processing.worker';
import { VideoQueueProducer } from './video-queue.producer';
import { VideosController } from './videos.controller';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        connection: {
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.name,
          schema: 'bullmq',
          migrate: true,
        } as unknown as ConnectionOptions,
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  controllers: [VideosController],
  providers: [
    VideoQueueProducer,
    UploadSessionService,
    VideosService,
    VideoProcessingWorker,
  ],
  exports: [TypeOrmModule, VideoQueueProducer, UploadSessionService],
})
export class VideosModule {}
