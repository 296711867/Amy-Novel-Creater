/**
 * IPC 写操作参数的运行时校验（AN-012）。
 *
 * IPC 参数是主进程的信任边界：渲染进程被攻破或扩展脚本伪造 invoke 时，
 * TypeScript 类型不起作用。这里用轻量组合子描述每个写通道的参数形状，
 * 在 handler 之前统一拦截；只检查类型与形状，不重建对象、不打日志输出
 * 参数值（可能包含 API Key 或正文）。
 */

export class IpcValidationError extends Error {
  constructor(channel: string, detail: string) {
    super(`IPC 参数校验失败（${channel}）：${detail}`);
    this.name = "IpcValidationError";
  }
}

export type ArgumentGuard = (
  value: unknown,
  path: string,
) => true | string;

/** 非空字符串：各类 ID 的最低要求。 */
export function id(): ArgumentGuard {
  return (value, path) =>
    typeof value === "string" && value.trim().length > 0
      ? true
      : `${path} 必须是非空字符串`;
}

/** 字符串：允许空串（正文、章纲等文本字段可清空）。 */
export function str(): ArgumentGuard {
  return (value, path) =>
    typeof value === "string" ? true : `${path} 必须是字符串`;
}

export function num(options?: {
  min?: number;
  max?: number;
  int?: boolean;
}): ArgumentGuard {
  const { min, max, int } = options ?? {};
  return (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      return `${path} 必须是有限数字`;
    if (int && !Number.isInteger(value)) return `${path} 必须是整数`;
    if (min !== undefined && value < min) return `${path} 不能小于 ${min}`;
    if (max !== undefined && value > max) return `${path} 不能大于 ${max}`;
    return true;
  };
}

export function boolean(): ArgumentGuard {
  return (value, path) => (typeof value === "boolean" ? true : `${path} 必须是布尔值`);
}

/** 枚举取值，等价封闭联合类型。 */
export function oneOf<T extends string>(values: readonly T[]): ArgumentGuard {
  return (value, path) =>
    typeof value === "string" && (values as readonly string[]).includes(value)
      ? true
      : `${path} 必须是 ${values.join(" / ")} 之一`;
}

export function arr(item: ArgumentGuard): ArgumentGuard {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} 必须是数组`;
    for (let index = 0; index < value.length; index++) {
      const result = item(value[index], `${path}[${index}]`);
      if (result !== true) return result;
    }
    return true;
  };
}

/**
 * 对象形状检查：声明的字段必须通过对应守卫，未声明的字段原样放行
 * （语义校验属于 Domain/数据库层，这里只做信任边界的类型防线）。
 */
export function obj(
  shape: Record<string, ArgumentGuard>,
): ArgumentGuard {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return `${path} 必须是对象`;
    for (const [key, guard] of Object.entries(shape)) {
      const result = guard((value as Record<string, unknown>)[key], `${path}.${key}`);
      if (result !== true) return result;
    }
    return true;
  };
}

/** 可选参数：传入 undefined 时放行，否则必须通过内部守卫。 */
export function optional(guard: ArgumentGuard): ArgumentGuard {
  return (value, path) => (value === undefined ? true : guard(value, path));
}

/** 可空参数：传入 null 时放行（如 workflow run 的 checkpoint 字段）。 */
export function nullable(guard: ArgumentGuard): ArgumentGuard {
  return (value, path) => (value === null ? true : guard(value, path));
}

export function validateIpcArgs(
  channel: string,
  guards: ArgumentGuard[],
  args: unknown[],
): void {
  for (let index = 0; index < guards.length; index++) {
    const result = guards[index](args[index], `参数 ${index + 1}`);
    if (result !== true) throw new IpcValidationError(channel, result);
  }
}
