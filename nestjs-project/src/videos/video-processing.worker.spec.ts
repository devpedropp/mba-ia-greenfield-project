import type { Job } from 'bullmq';
import { EventEmitter } from 'node:events';
import { Video, VideoStatus } from './entities/video.entity';
import { VideoProcessingWorker } from './video-processing.worker';

jest.mock('node:child_process');
jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn().mockResolvedValue('/tmp/video-fake'),
  rm: jest.fn().mockResolvedValue(undefined),
}));

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeFakeChild(options: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): ChildProcessWithoutNullStreams {
  const { exitCode = 0, stdout = '', stderr = '' } = options;
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

function makeJob(videoId: string): Job<{ videoId: string }> {
  return { data: { videoId } } as Job<{ videoId: string }>;
}

describe('VideoProcessingWorker', () => {
  let videoRepository: { findOneByOrFail: jest.Mock; save: jest.Mock };
  let storageService: { downloadToFile: jest.Mock; uploadFile: jest.Mock };
  let worker: VideoProcessingWorker;

  beforeEach(() => {
    videoRepository = {
      findOneByOrFail: jest.fn(),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    };
    storageService = {
      downloadToFile: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockResolvedValue(undefined),
    };
    worker = new VideoProcessingWorker(
      videoRepository as any,
      storageService as any,
    );
    mockedSpawn.mockReset();
  });

  it('extrai duration/metadata via ffprobe, gera thumbnail via ffmpeg e transiciona status para ready', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.PROCESSING,
    } as Video;
    videoRepository.findOneByOrFail.mockResolvedValue(video);
    const ffprobeJson = JSON.stringify({
      format: { duration: '12.5' },
      streams: [{ width: 1920, height: 1080 }],
    });
    mockedSpawn.mockImplementation((command: string) => {
      if (command === 'ffprobe') {
        return makeFakeChild({ stdout: ffprobeJson });
      }
      return makeFakeChild({});
    });

    await worker.process(makeJob('video-1'));

    expect(storageService.downloadToFile).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      expect.any(String),
    );
    expect(storageService.uploadFile).toHaveBeenCalledWith(
      'videos/video-1/thumbnail.jpg',
      expect.any(String),
      { contentType: 'image/jpeg' },
    );
    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.READY,
        duration: 13,
        metadata: expect.objectContaining({
          format: { duration: '12.5' },
        }) as unknown as Record<string, unknown>,
      }),
    );
  });

  it('nao reprocessa um video que ja esta ready (idempotencia)', async () => {
    const video = { id: 'video-1', status: VideoStatus.READY } as Video;
    videoRepository.findOneByOrFail.mockResolvedValue(video);

    await worker.process(makeJob('video-1'));

    expect(storageService.downloadToFile).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('transiciona status para failed quando o ffmpeg/ffprobe falha', async () => {
    const video = {
      id: 'video-1',
      status: VideoStatus.PROCESSING,
    } as Video;
    videoRepository.findOneByOrFail.mockResolvedValue(video);
    mockedSpawn.mockImplementation((command: string) => {
      if (command === 'ffprobe') {
        return makeFakeChild({ exitCode: 1, stderr: 'invalid data' });
      }
      return makeFakeChild({});
    });

    await expect(worker.process(makeJob('video-1'))).rejects.toThrow();

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: VideoStatus.FAILED }),
    );
  });
});
