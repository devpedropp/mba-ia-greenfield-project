import AwsS3 from "@uppy/aws-s3";
import Uppy from "@uppy/core";

import { wireUploadCompletion } from "./complete-upload";
import { signUploadRequest } from "./sign-upload-request";

const uppy = new Uppy().use(AwsS3, {
  shouldUseMultipart: true,
  signRequest: (request) => signUploadRequest(request),
});

wireUploadCompletion(uppy);

export default uppy;
