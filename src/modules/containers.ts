import path from 'path';
import { mkItem } from './helpers';
import { exists, dirSize, runCmd } from '../core/util';
import type { CleanerModule, Ctx, ModuleResult, CandidateItem } from '../core/types';

/**
 * Container & VM residue. Docker images/layers/build cache and the VM disk
 * images behind Docker Desktop, Colima, OrbStack, Podman and WSL2 are among the
 * largest invisible consumers of disk on modern dev machines, and they grow
 * silently. We surface their exact size, then offer the vendor-blessed prune
 * commands for layered content.
 */

async function scan(ctx: Ctx): Promise<ModuleResult> {
  const h = ctx.home;
  const L = path.join(h, 'Library');
  const items: CandidateItem[] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  // Docker data roots (VM disk images) — report with real size.
  const dockerRoots: Array<[string, string]> = [
    [path.join(L, 'Containers', 'com.docker.docker', 'Data', 'vms'), 'Docker Desktop 虚拟机磁盘 (Docker.raw)'],
    [path.join(h, '.docker'), 'Docker 客户端配置'],
    [path.join(h, '.colima'), 'Colima 虚拟机镜像'],
    [path.join(h, '.lima'), 'Lima 虚拟机镜像'],
    [path.join(h, '.orbstack'), 'OrbStack 数据'],
    [path.join(L, 'Group Containers', 'H9RJ2HU9JB.com.orbstack'), 'OrbStack 分组容器数据'],
    [path.join(h, '.local', 'share', 'containers'), 'Podman 存储 (rootless)'],
  ];
  if (ctx.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    dockerRoots.length = 0;
    dockerRoots.push(
      [path.join(local, 'Docker', 'wsl'), 'Docker Desktop WSL2 磁盘 (ext4.vhdx)'],
      [path.join(local, 'Docker', 'wsl', 'data'), 'Docker WSL 数据'],
      [path.join(h, '.docker'), 'Docker 客户端配置'],
    );
  }
  for (const [p, label] of dockerRoots) {
    if (!exists(p)) continue;
    try {
      const bytes = (await dirSize(p)).bytes;
      if (bytes <= 0) continue;
      items.push(mkItem({ module: 'containers', category: '容器与虚拟机', label, path: p, bytes, risk: 'expert', defaultSelected: false, strategy: 'info', detail: '虚拟机磁盘镜像；请用 Docker/Colima/WSL 自带命令回收空间，直接删除会损坏环境' }));
    } catch (e) {
      errors.push(`${p}: ${String(e)}`);
    }
  }

  // Layered Docker content: query the daemon when available.
  const df = await runCmd('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'], { timeoutMs: 15000 });
  const dockerAvailable = df.ok && !/cannot connect|error during connect|command not found/i.test(df.stderr);
  if (dockerAvailable) {
    for (const line of df.stdout.split('\n')) {
      const [type, size, reclaimable] = line.split('\t');
      if (!type) continue;
      items.push(
        mkItem({
          module: 'containers',
          category: 'Docker 分层内容',
          label: `${type}（可回收 ${reclaimable ?? '未知'}）`,
          detail: `当前占用 ${size ?? '未知'}；使用下方命令安全回收`,
          bytes: 0,
          risk: 'expert',
          defaultSelected: false,
          strategy: 'info',
        }),
      );
    }
    const commands: Array<[string, string]> = [
      ['docker container prune -f', 'Docker：清理已停止容器'],
      ['docker image prune -f', 'Docker：清理悬空镜像'],
      ['docker builder prune -f', 'Docker：清理构建缓存'],
      ['docker volume prune -f', 'Docker：清理未使用数据卷'],
      ['docker system prune -f', 'Docker：一键清理（容器+网络+悬空镜像+构建缓存）'],
    ];
    for (const [command, label] of commands) {
      items.push(mkItem({ module: 'containers', category: 'Docker 清理命令', label, command, kind: 'command', risk: 'expert', defaultSelected: false, strategy: 'exec' }));
    }
    notes.push('Docker 清理命令可在「执行」模式下运行；`image prune -a` 会删除所有未被容器使用的镜像，请谨慎。');
  } else {
    notes.push('未检测到运行中的 Docker 守护进程（或未安装），已跳过 Docker 分层统计。');
  }

  // Podman prune commands.
  const podman = await runCmd('podman', ['--version']);
  if (podman.ok) {
    items.push(mkItem({ module: 'containers', category: 'Podman 清理命令', label: 'Podman：清理未使用镜像/容器', command: 'podman system prune -f', kind: 'command', risk: 'expert', defaultSelected: false, strategy: 'exec' }));
  }

  // WSL note on Windows.
  if (ctx.platform === 'win32') {
    const wsl = await runCmd('wsl', ['-l', '-v'], { timeoutMs: 15000 });
    if (wsl.ok && wsl.stdout.trim()) {
      notes.push('WSL 发行版磁盘（ext4.vhdx）会随使用膨胀；可在发行版内执行 `sudo fstrim -av`，或用 `wsl --shutdown` 后由磁盘管理压缩虚拟磁盘。');
    }
  }

  notes.push('虚拟机磁盘镜像与「容器内数据」不同：镜像体积大但在运行，擅自删除会破坏开发环境。');
  notes.push('虚拟机磁盘镜像通常是稀疏文件，这里显示的是实际磁盘占用，而非其逻辑大小。');
  return { module: 'containers', title: '容器与虚拟机', description: 'Docker/Podman/Colima/OrbStack/WSL 的镜像、层、构建缓存与虚拟机磁盘。', category: 'containers', risk: 'expert', supported: true, items, notes, errors };
}

export const containersModule: CleanerModule = {
  id: 'containers',
  title: '容器与虚拟机',
  description: 'Docker、Podman、Colima、OrbStack、WSL 等容器与虚拟机的磁盘占用。',
  category: 'containers',
  risk: 'expert',
  platforms: ['darwin', 'win32', 'linux'],
  defaultEnabled: true,
  scan,
};
