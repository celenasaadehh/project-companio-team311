// Uploads media to encrypted S3 via a presigned URL.
import * as FileSystem from "expo-file-system/legacy";
import { requestMediaUploadUrl } from "./engine";

// iOS reports the same file under several MIME spellings -- Voice Memos hand
// back audio/x-m4a, the Files browser sometimes audio/aac -- and the backend
// allowlist knows only the canonical ones. Normalising here rather than
// widening the allowlist keeps the server's list of acceptable types short,
// which is the point of having one.
const CONTENT_TYPE_ALIASES = {
  "audio/x-m4a": "audio/m4a",
  "audio/aac": "audio/m4a",
  "audio/mp4a-latm": "audio/mp4",
  "audio/x-mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/vnd.wave": "audio/wav",
  "audio/wave": "audio/wav",
  "image/jpg": "image/jpeg",
};

export const UPLOADABLE_TYPES = new Set([
  "image/jpeg", "image/png",
  "audio/m4a", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm",
]);

export function normalizeContentType(type, fileUri) {
  let t = String(type || "").toLowerCase().split(";")[0].trim();
  t = CONTENT_TYPE_ALIASES[t] || t;
  if (UPLOADABLE_TYPES.has(t)) return t;

  // Fall back to the extension when the picker reports nothing useful.
  const ext = String(fileUri || "").toLowerCase().split("?")[0].split(".").pop();
  const byExt = {
    m4a: "audio/m4a", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
    webm: "audio/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  }[ext];
  return byExt || t;
}

export async function uploadMedia(patientId, fileUri, contentType) {
  if (!fileUri) throw new Error("No file to upload");

  const type = normalizeContentType(contentType, fileUri);
  if (!UPLOADABLE_TYPES.has(type)) {
    // Say which format was rejected: "unsupported media" with no name leaves
    // someone guessing which of their files was the problem.
    throw new Error(
      `Companio can't accept ${contentType || "that file type"}. ` +
      `Use M4A, MP3, WAV or WEBM for audio, or JPEG or PNG for images.`,
    );
  }

  const presign = await requestMediaUploadUrl(patientId, type);
  if (!presign?.upload_url || !presign?.s3_key) {
    throw new Error("Backend did not return a presigned upload URL");
  }
  const headers = presign.required_headers || {};

  const res = await FileSystem.uploadAsync(presign.upload_url, fileUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  if (res.status < 200 || res.status >= 300) {
    const body = String(res.body || "");
    const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
    const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1];
    const detail = code ? `${code}: ${message || ""}`.trim() : body.slice(0, 300);
    console.warn("S3 upload rejected:", res.status, body);
    throw new Error(`S3 upload failed (HTTP ${res.status})${detail ? ` — ${detail}` : ""}`);
  }
  return { s3_key: presign.s3_key, media_type: presign.media_type, bucket: presign.bucket };
}

export const uploadImage = (patientId, fileUri, type = "image/jpeg") => uploadMedia(patientId, fileUri, type);
export const uploadAudio = (patientId, fileUri, type = "audio/m4a") => uploadMedia(patientId, fileUri, type);
