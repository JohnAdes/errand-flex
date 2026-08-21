import { randomUUID } from "crypto";
import { env } from "../../env";
import { getFirebaseBucket } from "../../lib/firebaseAdmin";

export interface StorageProvider {
  /**
   * A signed URL the client can upload directly to (bypassing this API for
   * the actual file bytes), plus the final storage `ref` to send back in a
   * later API call — custody.service.ts's `driverSelfieRef`,
   * `packagePhotoRefs`, and `podPhotoRef` are all exactly this kind of ref,
   * already treated as an opaque string end-to-end.
   */
  createUploadUrl(input: { folder: string; contentType: string }): Promise<{ uploadUrl: string; ref: string }>;
}

/**
 * Default, offline-testable provider — what this codebase used before any
 * upload flow existed ("pass any string as the ref", per custody.service.ts's
 * existing comment), formalized into the same interface as the real one so
 * callers don't need to know which is active. The returned `uploadUrl` isn't
 * real; nothing actually receives bytes PUT to it.
 */
export class MockStorageProvider implements StorageProvider {
  async createUploadUrl(input: { folder: string; contentType: string }) {
    const ref = `mock/${input.folder}/${randomUUID()}`;
    return { uploadUrl: `https://mock-storage.invalid/${ref}?contentType=${encodeURIComponent(input.contentType)}`, ref };
  }
}

/**
 * Real Firebase Cloud Storage implementation, activated by
 * STORAGE_PROVIDER=firebase plus the same Firebase service-account
 * credentials AUTH_PROVIDER=firebase uses (lib/firebaseAdmin.ts) and
 * FIREBASE_STORAGE_BUCKET. A v4 signed URL is valid for 15 minutes and
 * scoped to exactly one object path + content type — the client must PUT
 * the raw file bytes to `uploadUrl` with a matching `Content-Type` header.
 */
export class FirebaseStorageProvider implements StorageProvider {
  async createUploadUrl(input: { folder: string; contentType: string }) {
    const ref = `${input.folder}/${randomUUID()}`;
    const bucket = getFirebaseBucket();
    const [uploadUrl] = await bucket.file(ref).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: input.contentType,
    });
    return { uploadUrl, ref };
  }
}

function buildStorageProvider(): StorageProvider {
  if (env.STORAGE_PROVIDER === "firebase") return new FirebaseStorageProvider();
  return new MockStorageProvider();
}

export const storageProvider: StorageProvider = buildStorageProvider();
