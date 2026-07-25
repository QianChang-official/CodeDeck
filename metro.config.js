const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro 自定义 resolver —— 编译期拦截非法原生依赖
 *
 * APK 模板只预装了有限的原生模块。如果 Agent 引入了不在白名单中的原生包，
 * Metro 编译虽然能通过（node_modules 存在），但 APK 运行时会 crash。
 *
 * 此 resolver 在 Metro 打包时拦截非法 import，直接抛出编译错误，
 * 让 Agent 在开发阶段就知道依赖不合法，而不是等到 APK 运行时才发现。
 */
const ALLOWED_DEPS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'scripts', 'allowed-deps.json'), 'utf8')
);
const BLOCKED_DEPS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'scripts', 'blocked-native-deps.json'), 'utf8')
);

// 从 import specifier 提取 npm 包名和 subpath。
// 白名单必须按包名判断，不能按完整 specifier 判断，否则会误伤：
//   expo/fetch                 -> packageName=expo, subpath=fetch
//   expo-file-system/legacy    -> packageName=expo-file-system, subpath=legacy
//   @expo/ui/jetpack-compose   -> packageName=@expo/ui, subpath=jetpack-compose
function parsePackageSpecifier(moduleName) {
  // @scope/package => @scope/package
  if (moduleName.startsWith('@')) {
    const parts = moduleName.split('/');
    const packageName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : moduleName;
    return {
      packageName,
      subpath: parts.length > 2 ? parts.slice(2).join('/') : '',
    };
  }
  // package/subpath => package
  const parts = moduleName.split('/');
  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? parts.slice(1).join('/') : '',
  };
}

function getTopLevelPkgName(moduleName) {
  return parsePackageSpecifier(moduleName).packageName;
}

// Metro resolver 的 resolveRequest 会拦截所有模块解析，包括 node_modules 内部的间接引用。
// 我们需要区分「用户代码的 import」和「node_modules 内部的间接引用」。
// 判断依据：如果解析请求的 originModulePath 属于 src 源码目录，则为用户直接引入。
const PROJECT_SRC_ROOT = path.join(__dirname, 'src');

function isUserSourceFile(originModulePath) {
  if (!originModulePath) return false;
  // 项目业务源码在 src 下，但不包括 node_modules
  const relativeToSrc = path.relative(PROJECT_SRC_ROOT, originModulePath);
  return relativeToSrc &&
         !relativeToSrc.startsWith('..') &&
         !path.isAbsolute(relativeToSrc) &&
         !originModulePath.includes(path.join('node_modules'));
}

// 项目内别名。不要把 "@/..."、"~/..." 误判为 scoped npm 包。
// 如果 alias 没有配置，后续交给 Metro 报正常的 "module not found"，而不是依赖白名单错误。
function isProjectAlias(moduleName) {
  return moduleName.startsWith('@/') || moduleName.startsWith('~/');
}

// 项目内相对路径和 Node 内置模块
function isBuiltinOrLocal(moduleName) {
  if (!moduleName) return true;
  // 相对路径: ./ ../
  if (moduleName.startsWith('.') || moduleName.startsWith('/')) return true;
  // 项目别名
  if (isProjectAlias(moduleName)) return true;
  // Node 内置模块
  if (moduleName.startsWith('node:') || isNodeBuiltin(moduleName)) return true;
  return false;
}

// 常见 Node 内置模块
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'crypto', 'events', 'fs', 'http', 'https', 'os', 'path',
  'process', 'stream', 'url', 'util', 'zlib', 'assert/strict', 'stream/promises',
  'timers', 'timers/promises', 'tty', 'net', 'querystring', 'string_decoder',
]);

function isNodeBuiltin(name) {
  return NODE_BUILTINS.has(name) || NODE_BUILTINS.has(getTopLevelPkgName(name));
}

// 白名单中的包放行
function isAllowedPkg(pkgName) {
  return pkgName in ALLOWED_DEPS;
}

// 从 resolved 文件路径向上查找包的 package.json，读取 version 字段
function getInstalledPkgVersion(resolvedFilePath, pkgName) {
  if (!resolvedFilePath) return null;
  // 从 resolved 路径向上查找包含 package.json 的目录
  let dir = path.dirname(resolvedFilePath);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const pkgJsonPath = path.join(dir, 'package.json');
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkgJson.name === pkgName) {
        return pkgJson.version || null;
      }
    } catch (_) {
      // package.json 不存在或无法解析，继续向上
    }
    // 遇到 node_modules 根目录边界，向上跳一级继续
    if (path.basename(dir) === 'node_modules') {
      dir = path.dirname(dir);
      continue;
    }
    dir = path.dirname(dir);
  }
  return null;
}

// 简易 semver satisfies：检查 installed 是否满足 allowedRange
// 支持 ~1.2.3、^1.2.3、精确版本 1.2.3
function versionSatisfies(installed, allowedRange) {
  if (!installed || !allowedRange) return false;
  // 去掉前缀 ^ ~ >= > <= <
  const cleanRange = allowedRange.replace(/^[\^~>=<]+/, '');
  const prefix = allowedRange.match(/^[\^~>=<]+/)?.[0] || '';

  const instParts = installed.split('.').map(Number);
  const rangeParts = cleanRange.split('.').map(Number);

  if (prefix === '~') {
    // ~1.2.3 => >=1.2.3 <1.3.0
    return instParts[0] === rangeParts[0] &&
           instParts[1] === rangeParts[1] &&
           instParts[2] >= rangeParts[2];
  }
  if (prefix === '^') {
    // ^1.2.3 => >=1.2.3 <2.0.0
    return instParts[0] === rangeParts[0] &&
           (instParts[1] > rangeParts[1] ||
            (instParts[1] === rangeParts[1] && instParts[2] >= rangeParts[2]));
  }
  // 精确版本
  return installed === cleanRange;
}

function dependencyGuardResolver(context, moduleName, platform, resolverOptions) {
  // 放行：相对路径、Node 内置模块
  if (isBuiltinOrLocal(moduleName)) {
    return context.resolveRequest(context, moduleName, platform, resolverOptions);
  }

  const { packageName: pkgName } = parsePackageSpecifier(moduleName);
  const originPath = context.originModulePath || context.file;
  const fromUserSource = originPath && isUserSourceFile(originPath);

  // 放行：node_modules 内部的间接引用（只拦截用户源码的直接 import）
  if (!fromUserSource) {
    return context.resolveRequest(context, moduleName, platform, resolverOptions);
  }

  // --- 以下只对用户源码的 import 做校验 ---

  // 黑名单包（未预装的原生包）→ 拦截并提示替代方案
  if (pkgName in BLOCKED_DEPS) {
    throw new Error(
      `❌ 禁止引入 "${pkgName}"：${BLOCKED_DEPS[pkgName]}，沙箱未预装，APK 运行时会 crash。\n` +
      `  → 黑名单见 scripts/blocked-native-deps.json`
    );
  }

  // 不在白名单也不在黑名单 → 纯 JS 包，放行
  if (!isAllowedPkg(pkgName)) {
    return context.resolveRequest(context, moduleName, platform, resolverOptions);
  }

  // 白名单包及其公开 subpath → 解析后校验版本。
  // 注意：这里必须先允许 subpath 进入 Metro 正常解析，避免误伤 expo/fetch、
  // expo-file-system/legacy、expo-router/entry 等白名单包自带入口。
  const resolution = context.resolveRequest(context, moduleName, platform, resolverOptions);
  const resolvedPath = resolution?.type === 'sourceFile' ? resolution.filePath : null;
  const installedVersion = getInstalledPkgVersion(resolvedPath, pkgName);
  const allowedVersion = ALLOWED_DEPS[pkgName];

  if (installedVersion && !versionSatisfies(installedVersion, allowedVersion)) {
    throw new Error(
      `❌ "${moduleName}" 版本不匹配：基础包 "${pkgName}" 已安装 ${installedVersion}，APK 预装版本要求 ${allowedVersion}。\n` +
      `  → 请将 package.json 中 ${pkgName} 的版本改为 "${allowedVersion}"。`
    );
  }

  return resolution;
}

const config = getDefaultConfig(__dirname);
const defaultGetModulesRunBeforeMainModule =
  config.serializer.getModulesRunBeforeMainModule;

config.serializer.getModulesRunBeforeMainModule = (entryFilePath) => {
  const defaultModules = defaultGetModulesRunBeforeMainModule
    ? defaultGetModulesRunBeforeMainModule(entryFilePath)
    : [];

  return [
    ...defaultModules,
    path.resolve(__dirname, 'src/jsErrorReporter.ts'),
  ];
};

config.resolver.resolveRequest = dependencyGuardResolver;

// 修复 ENOSPC: System limit for number of file watchers reached.
// 沙箱没有 watchman 时，Metro FallbackWatcher 会递归扫描 projectRoot。
// 这些目录不参与 JS 打包，屏蔽后可显著减少 node_modules 下的扫描/监听量。
const extraExcludes = [
  /[/\\](?:\.git|\.expo|\.turbo|\.next|coverage)(?:$|[/\\].*)/,
  /[/\\]android[/\\](?:\.gradle|\.cxx|build)(?:$|[/\\].*)/,
  /[/\\]android[/\\]app[/\\]build(?:$|[/\\].*)/,
  /[/\\]ios[/\\](?:Pods|build|DerivedData)(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\](?:prebuilds|dSYMs|spm-deps|__tests__|__fixtures__|docs|documentation|example|examples|website)(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\][^/\\]+\.xcframework(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\]android[/\\](?:\.gradle|\.cxx|build)(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\]android[/\\]app[/\\]build(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\]ReactAndroid[/\\]build(?:$|[/\\].*)/,
  /[/\\]node_modules[/\\].*[/\\]ios[/\\](?:Pods|build|DerivedData)(?:$|[/\\].*)/,
];
if (Array.isArray(config.resolver.blockList)) {
  config.resolver.blockList = config.resolver.blockList.concat(extraExcludes);
} else if (config.resolver.blockList) {
  config.resolver.blockList = [config.resolver.blockList].concat(extraExcludes);
} else {
  config.resolver.blockList = extraExcludes;
}

module.exports = config;
