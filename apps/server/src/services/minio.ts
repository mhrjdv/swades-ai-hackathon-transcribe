import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { env } from "@my-better-t-app/env/server";

export function createMinioClient(): S3Client {
  return new S3Client({
    endpoint: env.MINIO_ENDPOINT,
    region: "us-east-1",
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY,
      secretAccessKey: env.MINIO_SECRET_KEY,
    },
    forcePathStyle: true,
  });
}

export async function uploadChunk(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  checksum?: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ...(checksum ? { ChecksumSHA256: checksum } : {}),
  });

  try {
    await client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to upload chunk to MinIO at ${bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getChunk(
  client: S3Client,
  bucket: string,
  key: string
): Promise<ReadableStream> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });

  try {
    const response = await client.send(command);
    if (!response.Body) {
      throw new Error(`Empty body returned for ${bucket}/${key}`);
    }
    return response.Body.transformToWebStream();
  } catch (error) {
    throw new Error(
      `Failed to get chunk from MinIO at ${bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function chunkExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  const command = new HeadObjectCommand({ Bucket: bucket, Key: key });

  try {
    await client.send(command);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" || error.name === "NoSuchKey")
    ) {
      return false;
    }
    // Re-throw unexpected errors
    throw new Error(
      `Failed to check chunk existence at ${bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function deleteChunk(
  client: S3Client,
  bucket: string,
  key: string
): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });

  try {
    await client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to delete chunk from MinIO at ${bucket}/${key}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function listChunks(
  client: S3Client,
  bucket: string,
  sessionId: string
): Promise<string[]> {
  const prefix = `${sessionId}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const response = await client.send(command);
      const contents = response.Contents ?? [];
      for (const obj of contents) {
        if (obj.Key) {
          keys.push(obj.Key);
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys.sort();
  } catch (error) {
    throw new Error(
      `Failed to list chunks for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function ensureBucket(
  client: S3Client,
  bucket: string
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" || error.name === "NoSuchBucket")
    ) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createError) {
        throw new Error(
          `Failed to create bucket ${bucket}: ${createError instanceof Error ? createError.message : String(createError)}`
        );
      }
    } else {
      throw new Error(
        `Failed to check bucket ${bucket}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
