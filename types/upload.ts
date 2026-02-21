export type UploadFileItem = {
  filename: string;
  contentType: string;
  size: number;
  tags?: string[];
  folder?: string;
  exif?: string;
};

export type PresignRequest = {
  files: UploadFileItem[];
};
