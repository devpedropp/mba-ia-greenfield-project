import type { Queue } from 'bullmq';
import { VideoQueueProducer } from './video-queue.producer';
import { VIDEO_PROCESS_JOB } from './videos.constants';

function makeQueue(): { add: jest.Mock } {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

describe('VideoQueueProducer', () => {
  describe('enqueueProcessing', () => {
    it('should publish a video.process job with { videoId } to the queue', async () => {
      const queue = makeQueue();
      const producer = new VideoQueueProducer(queue as unknown as Queue);

      await producer.enqueueProcessing('video-id-1');

      expect(queue.add).toHaveBeenCalledWith(VIDEO_PROCESS_JOB, {
        videoId: 'video-id-1',
      });
    });
  });
});
