import fs from 'node:fs/promises';

export const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const writeJsonFile = async (
  filePath: string,
  data: unknown,
  pretty = true,
): Promise<void> => {
  const payload = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fs.writeFile(filePath, `${payload}\n`, 'utf-8');
};
