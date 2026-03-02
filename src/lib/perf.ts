export function choosePreviewSize(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 4) {
    return 768;
  }

  return 1024;
}
