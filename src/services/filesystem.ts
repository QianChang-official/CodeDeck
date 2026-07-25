// ============================================
// 文件系统服务 — 基于 expo-file-system/legacy
// 提供 文件读写 / 目录列表 / 图片转 base64 等能力
// 所有操作接入 capabilities 错误处理
// ============================================
import { requireFileSystem, CapabilityError, friendlyError } from './capabilities';
import type { MessageAttachment } from '../types';

// expo-file-system SDK 56 使用新 OO API，旧 API 在 /legacy 子路径下
type LegacyFS = typeof import('expo-file-system/legacy');

/** 动态加载 expo-file-system/legacy（web 端不可用） */
function getFS(): LegacyFS {
  requireFileSystem('文件系统操作');
  return require('expo-file-system/legacy');
}

/** documentDirectory — 应用沙箱文档目录 */
export function getDocumentDir(): string {
  const fs = getFS();
  return fs.documentDirectory ?? '';
}

/** cacheDirectory — 应用缓存目录 */
export function getCacheDir(): string {
  const fs = getFS();
  return fs.cacheDirectory ?? '';
}

/**
 * 读取文本文件内容
 * @param uri 文件 URI（content:// / file:// / app 沙箱路径）
 */
export async function readTextFile(uri: string): Promise<string> {
  try {
    const fs = getFS();
    const info = await fs.getInfoAsync(uri);
    if (!info.exists) {
      throw new CapabilityError('filesystem', `文件不存在：${uri}`, '请检查路径是否正确，或使用 file_list 查看可用文件。');
    }
    if (info.isDirectory) {
      throw new CapabilityError('filesystem', `路径是目录而非文件：${uri}`, '使用 file_list 列出目录内容。');
    }
    const content = await fs.readAsStringAsync(uri, {
      encoding: fs.EncodingType.UTF8,
    });
    return content;
  } catch (e) {
    if (e instanceof CapabilityError) throw e;
    throw new Error(friendlyError(e));
  }
}

/**
 * 写入文本文件（覆盖写入）
 * @param path 目标路径（若不含目录分隔符则写入 documentDirectory）
 * @param content 文件内容
 */
export async function writeTextFile(path: string, content: string): Promise<string> {
  try {
    const fs = getFS();
    let uri = path;
    // 若是纯文件名，拼接到文档目录
    if (!path.includes('/') && !path.startsWith('file://')) {
      uri = getDocumentDir() + path;
    }
    await fs.writeAsStringAsync(uri, content, {
      encoding: fs.EncodingType.UTF8,
    });
    return uri;
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

/**
 * 列出目录下的文件与子目录
 * @param dirPath 目录路径（默认 documentDirectory）
 */
export async function listDirectory(dirPath?: string): Promise<{ name: string; isDirectory: boolean; size: number; modificationTime: number }[]> {
  try {
    const fs = getFS();
    const dir = dirPath ?? getDocumentDir();
    if (!dir) throw new CapabilityError('filesystem', '无法获取文档目录');
    const info = await fs.getInfoAsync(dir);
    if (!info.exists) {
      throw new CapabilityError('filesystem', `目录不存在：${dir}`, '使用 file_write 创建文件后会自动生成目录。');
    }
    if (!info.isDirectory) {
      throw new CapabilityError('filesystem', `路径不是目录：${dir}`);
    }
    const items = await fs.readDirectoryAsync(dir);
    // 逐个获取详情（类型收窄：exists: true 时才有 size / modificationTime）
    const results = await Promise.all(
      items.map(async (name) => {
        try {
          const full = dir.endsWith('/') ? dir + name : dir + '/' + name;
          const fi = await fs.getInfoAsync(full);
          if (fi.exists) {
            return {
              name,
              isDirectory: fi.isDirectory,
              size: fi.size ?? 0,
              modificationTime: fi.modificationTime ?? 0,
            };
          }
          return { name, isDirectory: false, size: 0, modificationTime: 0 };
        } catch {
          return { name, isDirectory: false, size: 0, modificationTime: 0 };
        }
      }),
    );
    // 目录优先，再按名称排序
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return results;
  } catch (e) {
    if (e instanceof CapabilityError) throw e;
    throw new Error(friendlyError(e));
  }
}

/** 获取文件信息 */
export async function getFileInfo(uri: string): Promise<{ exists: boolean; size: number; isDirectory: boolean; modificationTime: number }> {
  const fs = getFS();
  const info = await fs.getInfoAsync(uri);
  if (info.exists) {
    return {
      exists: true,
      size: info.size ?? 0,
      isDirectory: info.isDirectory,
      modificationTime: info.modificationTime ?? 0,
    };
  }
  return { exists: false, size: 0, isDirectory: false, modificationTime: 0 };
}

/**
 * 读取图片文件并转为 base64 数据（供多模态 AI 使用）
 * 使用 expo-image-manipulator 压缩到合理尺寸后读取
 * @param uri 图片 URI
 * @param maxWidth 最大宽度（默认 1024，控制 token 消耗）
 * @returns { base64, mimeType, dataUri }
 */
export async function readImageAsBase64(
  uri: string,
  maxWidth = 1024,
): Promise<{ base64: string; mimeType: string; dataUri: string }> {
  try {
    const manipulator = require('expo-image-manipulator');

    // 压缩图片
    const manipulated = await manipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      { compress: 0.7, format: manipulator.SaveFormat.JPEG, base64: true },
    );

    const base64 = manipulated.base64 ?? '';
    if (!base64) {
      throw new CapabilityError('filesystem', '图片读取失败：无法获取 base64 数据');
    }

    return {
      base64,
      mimeType: 'image/jpeg',
      dataUri: `data:image/jpeg;base64,${base64}`,
    };
  } catch (e) {
    if (e instanceof CapabilityError) throw e;
    // 降级：直接用 expo-file-system 读取原始文件
    try {
      const fs = getFS();
      const info = await fs.getInfoAsync(uri);
      if (!info.exists) {
        throw new CapabilityError('filesystem', `图片文件不存在：${uri}`);
      }
      const base64 = await fs.readAsStringAsync(uri, { encoding: fs.EncodingType.Base64 });
      return {
        base64,
        mimeType: 'image/jpeg',
        dataUri: `data:image/jpeg;base64,${base64}`,
      };
    } catch (e2) {
      throw new Error(friendlyError(e2));
    }
  }
}

/**
 * 批量处理附件：图片转 base64，文件读取文本内容
 * 返回 AI 可用的内容描述
 */
export async function processAttachmentsForAI(
  attachments: MessageAttachment[],
): Promise<{ text: string; images: { base64: string; mimeType: string }[] }> {
  const images: { base64: string; mimeType: string }[] = [];
  const fileTexts: string[] = [];

  for (const att of attachments) {
    try {
      if (att.type === 'image') {
        const img = await readImageAsBase64(att.uri);
        images.push({ base64: img.base64, mimeType: img.mimeType });
      } else {
        // 文本类文件读取内容
        const textMimes = ['text/', 'application/json', 'application/javascript', 'application/xml'];
        const isText = textMimes.some((t) => att.mimeType.startsWith(t)) || /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yaml|yml|py|sh|sql|csv|log)$/i.test(att.name);
        if (isText) {
          const content = await readTextFile(att.uri);
          const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...(已截断)' : content;
          fileTexts.push(`📎 ${att.name}:\n\`\`\`\n${truncated}\n\`\`\``);
        } else {
          fileTexts.push(`📎 ${att.name}（${att.mimeType}，${(att.size / 1024).toFixed(1)}KB，二进制文件无法直接读取内容）`);
        }
      }
    } catch (e) {
      fileTexts.push(`📎 ${att.name}（读取失败：${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  return { text: fileTexts.join('\n\n'), images };
}
