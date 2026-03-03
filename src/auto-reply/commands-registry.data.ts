import { listChannelDocks } from "../channels/dock.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import { COMMAND_ARG_FORMATTERS } from "./commands-args.js";
import type {
  ChatCommandDefinition,
  CommandCategory,
  CommandScope,
} from "./commands-registry.types.js";
import { listThinkingLevels } from "./thinking.js";

type DefineChatCommandInput = {
  key: string;
  nativeName?: string;
  description: string;
  args?: ChatCommandDefinition["args"];
  argsParsing?: ChatCommandDefinition["argsParsing"];
  formatArgs?: ChatCommandDefinition["formatArgs"];
  argsMenu?: ChatCommandDefinition["argsMenu"];
  acceptsArgs?: boolean;
  textAlias?: string;
  textAliases?: string[];
  scope?: CommandScope;
  category?: CommandCategory;
};

function defineChatCommand(command: DefineChatCommandInput): ChatCommandDefinition {
  const aliases = (command.textAliases ?? (command.textAlias ? [command.textAlias] : []))
    .map((alias) => alias.trim())
    .filter(Boolean);
  const scope =
    command.scope ?? (command.nativeName ? (aliases.length ? "both" : "native") : "text");
  const acceptsArgs = command.acceptsArgs ?? Boolean(command.args?.length);
  const argsParsing = command.argsParsing ?? (command.args?.length ? "positional" : "none");
  return {
    key: command.key,
    nativeName: command.nativeName,
    description: command.description,
    acceptsArgs,
    args: command.args,
    argsParsing,
    formatArgs: command.formatArgs,
    argsMenu: command.argsMenu,
    textAliases: aliases,
    scope,
    category: command.category,
  };
}

type ChannelDock = ReturnType<typeof listChannelDocks>[number];

function defineDockCommand(dock: ChannelDock): ChatCommandDefinition {
  return defineChatCommand({
    key: `dock:${dock.id}`,
    nativeName: `dock_${dock.id}`,
    description: `Переключить ответы на ${dock.id}.`,
    textAliases: [`/dock-${dock.id}`, `/dock_${dock.id}`],
    category: "docks",
  });
}

function registerAlias(commands: ChatCommandDefinition[], key: string, ...aliases: string[]): void {
  const command = commands.find((entry) => entry.key === key);
  if (!command) {
    throw new Error(`registerAlias: unknown command key: ${key}`);
  }
  const existing = new Set(command.textAliases.map((alias) => alias.trim().toLowerCase()));
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }
    const lowered = trimmed.toLowerCase();
    if (existing.has(lowered)) {
      continue;
    }
    existing.add(lowered);
    command.textAliases.push(trimmed);
  }
}

function assertCommandRegistry(commands: ChatCommandDefinition[]): void {
  const keys = new Set<string>();
  const nativeNames = new Set<string>();
  const textAliases = new Set<string>();
  for (const command of commands) {
    if (keys.has(command.key)) {
      throw new Error(`Duplicate command key: ${command.key}`);
    }
    keys.add(command.key);

    const nativeName = command.nativeName?.trim();
    if (command.scope === "text") {
      if (nativeName) {
        throw new Error(`Text-only command has native name: ${command.key}`);
      }
      if (command.textAliases.length === 0) {
        throw new Error(`Text-only command missing text alias: ${command.key}`);
      }
    } else if (!nativeName) {
      throw new Error(`Native command missing native name: ${command.key}`);
    } else {
      const nativeKey = nativeName.toLowerCase();
      if (nativeNames.has(nativeKey)) {
        throw new Error(`Duplicate native command: ${nativeName}`);
      }
      nativeNames.add(nativeKey);
    }

    if (command.scope === "native" && command.textAliases.length > 0) {
      throw new Error(`Native-only command has text aliases: ${command.key}`);
    }

    for (const alias of command.textAliases) {
      if (!alias.startsWith("/")) {
        throw new Error(`Command alias missing leading '/': ${alias}`);
      }
      const aliasKey = alias.toLowerCase();
      if (textAliases.has(aliasKey)) {
        throw new Error(`Duplicate command alias: ${alias}`);
      }
      textAliases.add(aliasKey);
    }
  }
}

let cachedCommands: ChatCommandDefinition[] | null = null;
let cachedRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;
let cachedNativeCommandSurfaces: Set<string> | null = null;
let cachedNativeRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

function buildChatCommands(): ChatCommandDefinition[] {
  const commands: ChatCommandDefinition[] = [
    defineChatCommand({
      key: "help",
      nativeName: "help",
      description: "Показать доступные команды.",
      textAlias: "/help",
      category: "status",
    }),
    defineChatCommand({
      key: "commands",
      nativeName: "commands",
      description: "Список всех slash-команд.",
      textAlias: "/commands",
      category: "status",
    }),
    defineChatCommand({
      key: "skill",
      nativeName: "skill",
      description: "Запустить навык по имени.",
      textAlias: "/skill",
      category: "tools",
      args: [
        {
          name: "name",
          description: "Имя навыка",
          type: "string",
          required: true,
        },
        {
          name: "input",
          description: "Ввод для навыка",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "status",
      nativeName: "status",
      description: "Показать текущий статус.",
      textAlias: "/status",
      category: "status",
    }),
    defineChatCommand({
      key: "allowlist",
      description: "Показать, добавить или удалить записи allowlist.",
      textAlias: "/allowlist",
      acceptsArgs: true,
      scope: "text",
      category: "management",
    }),
    defineChatCommand({
      key: "approve",
      nativeName: "approve",
      description: "Одобрить или отклонить exec-запросы.",
      textAlias: "/approve",
      acceptsArgs: true,
      category: "management",
    }),
    defineChatCommand({
      key: "context",
      nativeName: "context",
      description: "Показать, как собирается и используется контекст.",
      textAlias: "/context",
      acceptsArgs: true,
      category: "status",
    }),
    defineChatCommand({
      key: "export-session",
      nativeName: "export-session",
      description: "Экспортировать текущую сессию в HTML с полным system prompt.",
      textAliases: ["/export-session", "/export"],
      acceptsArgs: true,
      category: "status",
      args: [
        {
          name: "path",
          description: "Путь вывода (по умолчанию: workspace)",
          type: "string",
          required: false,
        },
      ],
    }),
    defineChatCommand({
      key: "tts",
      nativeName: "tts",
      description: "Управление text-to-speech (TTS).",
      textAlias: "/tts",
      category: "media",
      args: [
        {
          name: "action",
          description: "Действие TTS",
          type: "string",
          choices: [
            { value: "on", label: "Вкл" },
            { value: "off", label: "Выкл" },
            { value: "status", label: "Статус" },
            { value: "provider", label: "Провайдер" },
            { value: "limit", label: "Лимит" },
            { value: "summary", label: "Сводка" },
            { value: "audio", label: "Аудио" },
            { value: "help", label: "Помощь" },
          ],
        },
        {
          name: "value",
          description: "Провайдер, лимит или текст",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: {
        arg: "action",
        title:
          "Действия TTS:\n" +
          "• on - Включить TTS для ответов\n" +
          "• off - Выключить TTS\n" +
          "• status - Показать текущие настройки\n" +
          "• provider - Выбрать голосовой провайдер (edge, elevenlabs, openai)\n" +
          "• limit - Задать максимум символов для TTS\n" +
          "• summary - Включить или выключить AI-сводку для длинных текстов\n" +
          "• audio - Сгенерировать TTS из произвольного текста\n" +
          "• help - Показать справку",
      },
    }),
    defineChatCommand({
      key: "whoami",
      nativeName: "whoami",
      description: "Показать ваш sender id.",
      textAlias: "/whoami",
      category: "status",
    }),
    defineChatCommand({
      key: "session",
      nativeName: "session",
      description: "Управление настройками сессии (например, /session idle).",
      textAlias: "/session",
      category: "session",
      args: [
        {
          name: "action",
          description: "idle | max-age",
          type: "string",
          choices: ["idle", "max-age"],
        },
        {
          name: "value",
          description: "Длительность (24h, 90m) или off",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "subagents",
      nativeName: "subagents",
      description: "Список, остановка, логи, запуск и управление subagent-задачами этой сессии.",
      textAlias: "/subagents",
      category: "management",
      args: [
        {
          name: "action",
          description: "list | kill | log | info | send | steer | spawn",
          type: "string",
          choices: ["list", "kill", "log", "info", "send", "steer", "spawn"],
        },
        {
          name: "target",
          description: "Run id, индекс или ключ сессии",
          type: "string",
        },
        {
          name: "value",
          description: "Дополнительный ввод (limit/message)",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "acp",
      nativeName: "acp",
      description: "Управление ACP-сессиями и runtime-настройками.",
      textAlias: "/acp",
      category: "management",
      args: [
        {
          name: "action",
          description: "Действие",
          type: "string",
          choices: [
            "spawn",
            "cancel",
            "steer",
            "close",
            "sessions",
            "status",
            "set-mode",
            "set",
            "cwd",
            "permissions",
            "timeout",
            "model",
            "reset-options",
            "doctor",
            "install",
            "help",
          ],
        },
        {
          name: "value",
          description: "Аргументы действия",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "focus",
      nativeName: "focus",
      description: "Привязать этот Discord-тред (или новый) к цели сессии.",
      textAlias: "/focus",
      category: "management",
      args: [
        {
          name: "target",
          description: "Метка/индекс subagent-а или ключ/id/label сессии",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "unfocus",
      nativeName: "unfocus",
      description: "Убрать текущую привязку Discord-треда.",
      textAlias: "/unfocus",
      category: "management",
    }),
    defineChatCommand({
      key: "agents",
      nativeName: "agents",
      description: "Список агентов, привязанных к тредам этой сессии.",
      textAlias: "/agents",
      category: "management",
    }),
    defineChatCommand({
      key: "kill",
      nativeName: "kill",
      description: "Остановить запущенного subagent-а (или всех).",
      textAlias: "/kill",
      category: "management",
      args: [
        {
          name: "target",
          description: "Метка, run id, index или all",
          type: "string",
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "steer",
      nativeName: "steer",
      description: "Отправить указание запущенному subagent-у.",
      textAlias: "/steer",
      category: "management",
      args: [
        {
          name: "target",
          description: "Метка, run id или index",
          type: "string",
        },
        {
          name: "message",
          description: "Сообщение для steer",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "config",
      nativeName: "config",
      description: "Показать или изменить значения конфига.",
      textAlias: "/config",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | get | set | unset",
          type: "string",
          choices: ["show", "get", "set", "unset"],
        },
        {
          name: "path",
          description: "Путь конфига",
          type: "string",
        },
        {
          name: "value",
          description: "Значение для set",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.config,
    }),
    defineChatCommand({
      key: "debug",
      nativeName: "debug",
      description: "Установить runtime debug-переопределения.",
      textAlias: "/debug",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | reset | set | unset",
          type: "string",
          choices: ["show", "reset", "set", "unset"],
        },
        {
          name: "path",
          description: "Путь debug",
          type: "string",
        },
        {
          name: "value",
          description: "Значение для set",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.debug,
    }),
    defineChatCommand({
      key: "usage",
      nativeName: "usage",
      description: "Показать footer использования или сводку по стоимости.",
      textAlias: "/usage",
      category: "options",
      args: [
        {
          name: "mode",
          description: "off, tokens, full или cost",
          type: "string",
          choices: ["off", "tokens", "full", "cost"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "stop",
      nativeName: "stop",
      description: "Остановить текущий запуск.",
      textAlias: "/stop",
      category: "session",
    }),
    defineChatCommand({
      key: "restart",
      nativeName: "restart",
      description: "Перезапустить OpenClaw.",
      textAlias: "/restart",
      category: "tools",
    }),
    defineChatCommand({
      key: "activation",
      nativeName: "activation",
      description: "Установить режим активации группы.",
      textAlias: "/activation",
      category: "management",
      args: [
        {
          name: "mode",
          description: "mention или always",
          type: "string",
          choices: ["mention", "always"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "send",
      nativeName: "send",
      description: "Установить политику отправки.",
      textAlias: "/send",
      category: "management",
      args: [
        {
          name: "mode",
          description: "on, off или inherit",
          type: "string",
          choices: ["on", "off", "inherit"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "reset",
      nativeName: "reset",
      description: "Сбросить текущую сессию.",
      textAlias: "/reset",
      acceptsArgs: true,
      category: "session",
    }),
    defineChatCommand({
      key: "new",
      nativeName: "new",
      description: "Начать новую сессию.",
      textAlias: "/new",
      acceptsArgs: true,
      category: "session",
    }),
    defineChatCommand({
      key: "compact",
      nativeName: "compact",
      description: "Уплотнить контекст сессии.",
      textAlias: "/compact",
      category: "session",
      args: [
        {
          name: "instructions",
          description: "Дополнительные инструкции для compact",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "think",
      nativeName: "think",
      description: "Установить уровень размышления.",
      textAlias: "/think",
      category: "options",
      args: [
        {
          name: "level",
          description: "off, minimal, low, medium, high, xhigh",
          type: "string",
          choices: ({ provider, model }) => listThinkingLevels(provider, model),
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "verbose",
      nativeName: "verbose",
      description: "Переключить подробный режим.",
      textAlias: "/verbose",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on или off",
          type: "string",
          choices: ["on", "off"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "reasoning",
      nativeName: "reasoning",
      description: "Переключить видимость reasoning.",
      textAlias: "/reasoning",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off или stream",
          type: "string",
          choices: ["on", "off", "stream"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "elevated",
      nativeName: "elevated",
      description: "Переключить elevated-режим.",
      textAlias: "/elevated",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off, ask или full",
          type: "string",
          choices: ["on", "off", "ask", "full"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "exec",
      nativeName: "exec",
      description: "Установить exec-настройки по умолчанию для этой сессии.",
      textAlias: "/exec",
      category: "options",
      args: [
        {
          name: "host",
          description: "sandbox, gateway или node",
          type: "string",
          choices: ["sandbox", "gateway", "node"],
        },
        {
          name: "security",
          description: "deny, allowlist или full",
          type: "string",
          choices: ["deny", "allowlist", "full"],
        },
        {
          name: "ask",
          description: "off, on-miss или always",
          type: "string",
          choices: ["off", "on-miss", "always"],
        },
        {
          name: "node",
          description: "Node id или имя",
          type: "string",
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.exec,
    }),
    defineChatCommand({
      key: "model",
      nativeName: "model",
      description: "Показать или выбрать модель.",
      textAlias: "/model",
      category: "options",
      args: [
        {
          name: "model",
          description: "Model id (provider/model или id)",
          type: "string",
        },
      ],
    }),
    defineChatCommand({
      key: "models",
      nativeName: "models",
      description: "Показать провайдеров моделей или модели провайдера.",
      textAlias: "/models",
      argsParsing: "none",
      acceptsArgs: true,
      category: "options",
    }),
    defineChatCommand({
      key: "queue",
      nativeName: "queue",
      description: "Настроить очередь.",
      textAlias: "/queue",
      category: "options",
      args: [
        {
          name: "mode",
          description: "Режим очереди",
          type: "string",
          choices: ["steer", "interrupt", "followup", "collect", "steer-backlog"],
        },
        {
          name: "debounce",
          description: "Задержка debounce (например, 500ms, 2s)",
          type: "string",
        },
        {
          name: "cap",
          description: "Лимит очереди",
          type: "number",
        },
        {
          name: "drop",
          description: "Политика сброса",
          type: "string",
          choices: ["old", "new", "summarize"],
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.queue,
    }),
    defineChatCommand({
      key: "bash",
      description: "Выполнить shell-команды хоста (только на хосте).",
      textAlias: "/bash",
      scope: "text",
      category: "tools",
      args: [
        {
          name: "command",
          description: "Shell-команда",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    ...listChannelDocks()
      .filter((dock) => dock.capabilities.nativeCommands)
      .map((dock) => defineDockCommand(dock)),
  ];

  registerAlias(commands, "whoami", "/id");
  registerAlias(commands, "think", "/thinking", "/t");
  registerAlias(commands, "verbose", "/v");
  registerAlias(commands, "reasoning", "/reason");
  registerAlias(commands, "elevated", "/elev");
  registerAlias(commands, "steer", "/tell");

  assertCommandRegistry(commands);
  return commands;
}

export function getChatCommands(): ChatCommandDefinition[] {
  const registry = getActivePluginRegistry();
  if (cachedCommands && registry === cachedRegistry) {
    return cachedCommands;
  }
  const commands = buildChatCommands();
  cachedCommands = commands;
  cachedRegistry = registry;
  cachedNativeCommandSurfaces = null;
  return commands;
}

export function getNativeCommandSurfaces(): Set<string> {
  const registry = getActivePluginRegistry();
  if (cachedNativeCommandSurfaces && registry === cachedNativeRegistry) {
    return cachedNativeCommandSurfaces;
  }
  cachedNativeCommandSurfaces = new Set(
    listChannelDocks()
      .filter((dock) => dock.capabilities.nativeCommands)
      .map((dock) => dock.id),
  );
  cachedNativeRegistry = registry;
  return cachedNativeCommandSurfaces;
}
