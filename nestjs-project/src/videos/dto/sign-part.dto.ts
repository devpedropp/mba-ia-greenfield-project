import { IsInt, IsString, Min } from 'class-validator';

export class SignPartDto {
  @IsString()
  method: string;

  @IsString()
  uploadId: string;

  @IsInt()
  @Min(1)
  partNumber: number;
}
