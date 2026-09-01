// Camera abstraction: phone today, smart glasses when hardware exists.
export const CameraProviderType = {
  PHONE: "phone",
  SMART_GLASSES: "smart_glasses",
};

class PhoneCameraProvider {
  type = CameraProviderType.PHONE;

  async isAvailable() {
    return true;
  }

  async connect() {
    return { ok: true };
  }

  async disconnect() {}

  getStatus() {
    return { connected: true, type: this.type, demo: false };
  }

  async captureImage(cameraRef, opts = {}) {
    if (!cameraRef?.current) throw new Error("Camera not ready");
    const pic = await cameraRef.current.takePictureAsync({ quality: 0.5, ...opts });
    if (!pic?.uri) throw new Error("Capture failed");
    return { uri: pic.uri, base64: pic.base64 || null };
  }
}

class SmartGlassesCameraProvider {
  type = CameraProviderType.SMART_GLASSES;

  async isAvailable() {
    return false;
  }

  async connect() {
    return { ok: false, reason: "no_sdk_linked" };
  }

  async disconnect() {}

  getStatus() {
    return {
      connected: false,
      type: this.type,
      demo: true,
      reason: "No smart-glasses SDK is linked into this build — see cameraProvider.js.",
    };
  }

  async captureImage() {
    throw new Error("Smart glasses SDK not linked — no real capture available. Use the phone camera instead.");
  }
}

export function createCameraProvider(type) {
  if (type === CameraProviderType.SMART_GLASSES) return new SmartGlassesCameraProvider();
  return new PhoneCameraProvider();
}
