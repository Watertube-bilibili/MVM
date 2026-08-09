import { CoreAnalysisError, CoreErrorCode } from "./errors.js";

export type PlistValue =
  | null
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistArray
  | PlistDictionary;

export interface PlistArray extends ReadonlyArray<PlistValue> {}

export interface PlistDictionary {
  readonly [key: string]: PlistValue;
}

export interface PlistParserLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
}

export const DEFAULT_PLIST_LIMITS: PlistParserLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 100_000,
  maxStringBytes: 1024 * 1024,
};

export interface InfoPlistAdapter {
  readonly id: string;
  parse(data: Uint8Array): Promise<PlistValue>;
}

interface NormalizationState {
  nodes: number;
}

function startsWithBytes(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => data[index] === value);
}

function decodeTextPlist(data: Uint8Array): string {
  try {
    if (startsWithBytes(data, [0xef, 0xbb, 0xbf])) {
      return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(3));
    }
    if (startsWithBytes(data, [0xff, 0xfe])) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(data.subarray(2));
    }
    if (startsWithBytes(data, [0xfe, 0xff])) {
      return new TextDecoder("utf-16be", { fatal: true }).decode(data.subarray(2));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    throw new CoreAnalysisError({
      code: CoreErrorCode.PlistInvalid,
      stage: "analyzing",
      message: "Text Info.plist has invalid character encoding.",
      cause: error,
    });
  }
}

function parserInput(data: Uint8Array): string | Uint8Array {
  return startsWithBytes(data, [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30])
    ? Uint8Array.from(data)
    : decodeTextPlist(data);
}

function plistError(message: string, details?: Readonly<Record<string, unknown>>): CoreAnalysisError {
  return new CoreAnalysisError({
    code: CoreErrorCode.PlistInvalid,
    stage: "analyzing",
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function checkString(value: string, limits: PlistParserLimits, label: string): string {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > limits.maxStringBytes) {
    throw plistError(`${label} exceeds the configured plist string limit.`, {
      byteLength,
      maxStringBytes: limits.maxStringBytes,
    });
  }
  return value;
}

function normalizePlistValue(
  value: unknown,
  depth: number,
  limits: PlistParserLimits,
  state: NormalizationState,
): PlistValue {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    throw plistError("Property list contains too many values.", {
      maxNodes: limits.maxNodes,
    });
  }
  if (depth > limits.maxDepth) {
    throw plistError("Property list nesting exceeds the configured limit.", {
      maxDepth: limits.maxDepth,
    });
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return checkString(value, limits, "Property list string");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw plistError("Property list contains a non-finite number.");
    }
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw plistError("Property list contains an invalid date.");
    }
    return new Date(value.getTime());
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > limits.maxBytes) {
      throw plistError("Property list data value exceeds the configured byte limit.", {
        byteLength: value.byteLength,
        maxBytes: limits.maxBytes,
      });
    }
    return Uint8Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePlistValue(item, depth + 1, limits, state));
  }
  if (typeof value === "object") {
    const dictionary = Object.create(null) as Record<string, PlistValue>;
    for (const [key, item] of Object.entries(value)) {
      checkString(key, limits, "Property list key");
      Object.defineProperty(dictionary, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: normalizePlistValue(item, depth + 1, limits, state),
      });
    }
    return Object.freeze(dictionary);
  }

  throw plistError("Property list parser returned an unsupported value type.", {
    valueType: typeof value,
  });
}

export class PlistV5Adapter implements InfoPlistAdapter {
  public readonly id = "plist-v5";

  public constructor(private readonly limits: PlistParserLimits = DEFAULT_PLIST_LIMITS) {}

  public async parse(data: Uint8Array): Promise<PlistValue> {
    if (data.byteLength > this.limits.maxBytes) {
      throw plistError("Info.plist exceeds the configured byte limit.", {
        byteLength: data.byteLength,
        maxBytes: this.limits.maxBytes,
      });
    }

    try {
      const plist = await import("plist");
      const parsed = plist.parse(parserInput(data));
      return normalizePlistValue(parsed, 0, this.limits, { nodes: 0 });
    } catch (error) {
      if (error instanceof CoreAnalysisError) {
        throw error;
      }
      throw new CoreAnalysisError({
        code: CoreErrorCode.PlistInvalid,
        stage: "analyzing",
        message: "Info.plist could not be parsed by the plist v5 adapter.",
        cause: error,
        details: {
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

export function isPlistDictionary(value: PlistValue): value is PlistDictionary {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}
