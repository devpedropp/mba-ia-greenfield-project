import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { AbortUploadDto } from './dto/abort-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { SignPartDto } from './dto/sign-part.dto';
import { UploadSessionService } from './upload-session.service';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly uploadSessionService: UploadSessionService,
    private readonly videosService: VideosService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start an upload session',
    description:
      'Creates a video draft for the authenticated channel and initiates a multipart upload.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload session created',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'draft' },
        uploadId: { type: 'string' },
        key: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async createDraft(@CurrentUser() user: JwtPayload) {
    return this.uploadSessionService.createDraft(user.sub);
  }

  @Post(':id/parts/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign a multipart upload part',
    description:
      'Returns a presigned URL the frontend uses to PUT a single part directly to object storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Signed URL issued',
    schema: {
      properties: {
        url: { type: 'string' },
        headers: { type: 'object', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in a valid upload state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signPart(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SignPartDto,
  ) {
    return this.uploadSessionService.signPart(user.sub, id, {
      uploadId: dto.uploadId,
      partNumber: dto.partNumber,
    });
  }

  @Get(':id/parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the multipart upload parts already received by object storage, for resume support.',
  })
  @ApiResponse({
    status: 200,
    description: 'Parts already uploaded',
    schema: {
      properties: {
        parts: {
          type: 'array',
          items: {
            properties: {
              partNumber: { type: 'integer' },
              ETag: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in a valid upload state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listParts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('uploadId') uploadId: string,
  ) {
    const parts = await this.uploadSessionService.listParts(
      user.sub,
      id,
      uploadId,
    );
    return { parts };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete an upload session',
    description:
      'Finalizes the multipart upload and enqueues the video for background processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in a valid upload state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.uploadSessionService.completeUpload(user.sub, id, {
      uploadId: dto.uploadId,
      parts: dto.parts,
    });
  }

  @Post(':id/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Abort an upload session',
    description: 'Aborts an in-progress multipart upload.',
  })
  @ApiResponse({ status: 204, description: 'Upload session aborted' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in a valid upload state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abort(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AbortUploadDto,
  ): Promise<void> {
    await this.uploadSessionService.abortUpload(user.sub, id, dto.uploadId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get video detail/status',
    description:
      'Returns the video processing status and, once ready, signed URLs for streaming, download, and the thumbnail.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video detail',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'ready' },
        duration: { type: 'integer', nullable: true },
        streamUrl: { type: 'string', nullable: true },
        downloadUrl: { type: 'string', nullable: true },
        thumbnailUrl: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videosService.getById(user.sub, id);
  }
}
