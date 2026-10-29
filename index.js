
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const express = require("express");
const session = require("express-session");

const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionsBitField,

  MessageFlags,

  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,

  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

// ============================================================
// 1. GLOBAL CONFIGURATION
// ============================================================

const VEYX_VERSION = "6.0.0";

const PORT = Number(process.env.PORT || 3000);

const BASE_URL = (
  process.env.BASE_URL ||
  `http://localhost:${PORT}`
).replace(/\/+$/, "");

const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  `${BASE_URL}/auth/callback`;

const ERLC_API_URL = (
  process.env.ERLC_API_URL ||
  "https://api.policeroleplay.community"
).replace(/\/+$/, "");

const IS_PRODUCTION =
  process.env.NODE_ENV === "production";

const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "SESSION_SECRET",
  "ENCRYPTION_KEY"
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(
      `[VEYX] Missing environment variable: ${key}`
    );
  }
}

if (
  !/^[a-fA-F0-9]{64}$/.test(
    process.env.ENCRYPTION_KEY
  )
) {
  throw new Error(
    "[VEYX] ENCRYPTION_KEY must be 64 hexadecimal characters."
  );
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error(
    "[VEYX] SESSION_SECRET must be at least 32 characters."
  );
}

const ENCRYPTION_KEY = Buffer.from(
  process.env.ENCRYPTION_KEY,
  "hex"
);

// ============================================================
// 2. DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],

  allowedMentions: {
    parse: []
  }
});

// ============================================================
// 3. EXPRESS APPLICATION
// ============================================================

const app = express();

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "32kb"
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "32kb"
  })
);

if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

// Session middleware and routes are added in Part 4.

// ============================================================
// 4. FILE DATABASE
// ============================================================

const DATA_DIRECTORY = path.join(
  __dirname,
  "data"
);

const DATABASE_PATH = path.join(
  DATA_DIRECTORY,
  "veyx.json"
);

fs.mkdirSync(
  DATA_DIRECTORY,
  {
    recursive: true
  }
);

let database = {
  guilds: {}
};

if (fs.existsSync(DATABASE_PATH)) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(
        DATABASE_PATH,
        "utf8"
      )
    );

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.guilds &&
      typeof parsed.guilds === "object"
    ) {
      database = parsed;
    }
  } catch (error) {
    throw new Error(
      `[VEYX] Could not load database: ${error.message}`
    );
  }
}

let saveTimer = null;

function saveDatabaseNow() {
  const temporaryPath =
    DATABASE_PATH + ".tmp";

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(database, null, 2),
    {
      mode: 0o600
    }
  );

  fs.renameSync(
    temporaryPath,
    DATABASE_PATH
  );
}

function saveDatabase() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;

    try {
      saveDatabaseNow();
    } catch (error) {
      console.error(
        "[VEYX DATABASE]",
        error
      );
    }
  }, 250);
}

function flushDatabase() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  saveDatabaseNow();
}

// ============================================================
// 5. DEFAULT SERVER SETTINGS
// ============================================================

function createDefaultSettings() {
  return {
    // ----------------------------------------
    // General
    // ----------------------------------------

    prefix: "!",

    apiKeyEncrypted: null,

    // ----------------------------------------
    // Discord permissions
    // ----------------------------------------

    roles: {
      staff: null,
      seniorStaff: null,
      administrator: null
    },

    // ----------------------------------------
    // Channels
    // ----------------------------------------

    channels: {
      generalLogs: null,
      joinLogs: null,
      killLogs: null,
      commandLogs: null,
      moderationLogs: null,

      sessionAnnouncements: null,
      sessionVotes: null,
      staffLogs: null
    },

    // ----------------------------------------
    // Logging
    // ----------------------------------------

    logging: {
      enabled: false,

      joins: false,
      leaves: false,
      kills: false,
      commands: false,

      moderation: true,
      staffShifts: true,
      sessions: true
    },

    // ----------------------------------------
    // Session configuration
    // ----------------------------------------

    sessions: {
      enabled: true,

      // Required number of YES votes
      requiredVotes: 10,

      // Vote duration in minutes
      voteDuration: 10,

      // Automatically start a session
      // after the vote reaches its target
      autoStart: false,

      // Allow voters to change their vote
      allowVoteChanges: true,

      // Allow NO votes
      allowNoVotes: true,

      // Close vote when required YES
      // votes are reached
      closeOnSuccess: true,

      // Allow one active vote at a time
      oneVoteAtATime: true,

      // --------------------------------------
      // Session messages
      // --------------------------------------

      messages: {
        voteTitle:
          "VEYX / SESSION VOTE",

        voteDescription:
          "Should we start a roleplay session?\n" +
          "Use the buttons below to vote.",

        startupTitle:
          "VEYX / SESSION STARTUP",

        startupDescription:
          "A roleplay session has started.\n" +
          "You may now join the ER:LC server.",

        shutdownTitle:
          "VEYX / SESSION SHUTDOWN",

        shutdownDescription:
          "The roleplay session has ended.\n" +
          "Thank you for participating.",

        boostTitle:
          "VEYX / SESSION BOOST",

        boostDescription:
          "Our roleplay session is active.\n" +
          "Join the server and participate.",

        approvedTitle:
          "VEYX / VOTE APPROVED",

        approvedDescription:
          "The required number of votes has been reached.",

        failedTitle:
          "VEYX / VOTE CLOSED",

        failedDescription:
          "The session vote has closed without reaching the required votes."
      },

      // --------------------------------------
      // Session buttons
      // --------------------------------------

      buttons: {
        yesLabel: "Vote Yes",
        noLabel: "Vote No",
        resultsLabel: "View Results",

        joinLabel: "Join Server",

        showResultsButton: true,
        showJoinButton: true
      },

      // --------------------------------------
      // Session state
      // --------------------------------------

      active: false,

      startedAt: null,

      startedBy: null,

      activeVoteId: null,

      votes: {},

      history: []
    },

    // ----------------------------------------
    // Moderation
    // ----------------------------------------

    moderation: {
      warnings: {},
      notes: {},
      cases: [],
      bolos: []
    },

    // ----------------------------------------
    // Staff management
    // ----------------------------------------

    staff: {
      activeShifts: {},
      shiftTotals: {},
      shiftHistory: []
    },

    // ----------------------------------------
    // Statistics
    // ----------------------------------------

    statistics: {
      commandsExecuted: 0,

      remoteCommands: 0,

      warningsIssued: 0,

      sessionsStarted: 0,

      sessionsEnded: 0,

      votesCreated: 0,

      votesApproved: 0,

      votesFailed: 0
    },

    // ----------------------------------------
    // Audit events
    // ----------------------------------------

    events: []
  };
}

// ============================================================
// 6. DEEP DEFAULT MERGING
// ============================================================

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function mergeDefaults(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = structuredClone(value);
      continue;
    }

    if (
      isPlainObject(value) &&
      isPlainObject(target[key])
    ) {
      mergeDefaults(
        target[key],
        value
      );
    }
  }

  return target;
}

// ============================================================
// 7. GET GUILD SETTINGS
// ============================================================

function getGuildSettings(guildId) {
  if (
    typeof guildId !== "string" ||
    !/^\d{17,22}$/.test(guildId)
  ) {
    throw new Error(
      "Invalid Discord guild ID."
    );
  }

  if (!database.guilds[guildId]) {
    database.guilds[guildId] =
      createDefaultSettings();

    saveDatabase();
  }

  return mergeDefaults(
    database.guilds[guildId],
    createDefaultSettings()
  );
}

// ============================================================
// 8. AUDIT LOGGING
// ============================================================

function addAuditEvent(
  guildId,
  type,
  description,
  userId = null
) {
  const settings = getGuildSettings(guildId);

  const event = {
    id: crypto.randomUUID(),

    type: String(type),

    description: String(description),

    userId,

    timestamp: Date.now()
  };

  settings.events.unshift(event);

  if (settings.events.length > 500) {
    settings.events.length = 500;
  }

  saveDatabase();

  return event;
}

// ============================================================
// 9. API KEY ENCRYPTION
// ============================================================

function encryptSecret(plaintext) {
  if (
    typeof plaintext !== "string" ||
    !plaintext
  ) {
    throw new Error(
      "Cannot encrypt an empty secret."
    );
  }

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(
      plaintext,
      "utf8"
    ),

    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

function decryptSecret(encryptedValue) {
  if (
    typeof encryptedValue !== "string"
  ) {
    throw new Error(
      "Invalid encrypted secret."
    );
  }

  const parts = encryptedValue.split(":");

  if (
    parts.length !== 4 ||
    parts[0] !== "v1"
  ) {
    throw new Error(
      "Unsupported encrypted secret format."
    );
  }

  const iv = Buffer.from(
    parts[1],
    "hex"
  );

  const authTag = Buffer.from(
    parts[2],
    "hex"
  );

  const encrypted = Buffer.from(
    parts[3],
    "hex"
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

// ============================================================
// 10. ER:LC API CACHE
// ============================================================

const erlcCache = new Map();

const erlcPending = new Map();

const erlcCommandQueues = new Map();

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function clearGuildApiCache(guildId) {
  for (const key of erlcCache.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      erlcCache.delete(key);
    }
  }
}

// ============================================================
// 11. ER:LC API REQUESTS
// ============================================================

async function erlcRequest(
  guildId,
  endpoint,
  options = {}
) {
  const settings = getGuildSettings(guildId);

  if (!settings.apiKeyEncrypted) {
    throw new Error(
      "ER:LC is not connected. Add your API key in the dashboard."
    );
  }

  const apiKey = decryptSecret(
    settings.apiKeyEncrypted
  );

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const response = await fetch(
      `${ERLC_API_URL}${endpoint}`,
      {
        method: options.method || "GET",

        headers: {
          "Server-Key": apiKey,
          "Content-Type": "application/json"
        },

        body: options.body
          ? JSON.stringify(options.body)
          : undefined,

        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errors = {
        400: "Invalid ER:LC API request.",
        401: "Invalid ER:LC API key.",
        403: "ER:LC API access denied.",
        404: "ER:LC API endpoint not found.",
        422: "ER:LC server data is unavailable.",
        429: "ER:LC API rate limit reached.",
        500: "ER:LC API server error.",
        502: "ER:LC API is temporarily unavailable.",
        503: "ER:LC API is temporarily unavailable."
      };

      throw new Error(
        errors[response.status] ||
        `ER:LC API returned HTTP ${response.status}.`
      );
    }

    const text = await response.text();

    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {
        message: text
      };
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "ER:LC API request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// 12. ER:LC SERVER INFORMATION
// ============================================================

async function getErlcServer(
  guildId,
  sections = []
) {
  const allowedSections = new Set([
    "Players",
    "Staff",
    "Queue",
    "Vehicles",
    "JoinLogs",
    "KillLogs",
    "CommandLogs",
    "ModCalls",
    "EmergencyCalls"
  ]);

  const selected = [
    ...new Set(
      sections.filter(section =>
        allowedSections.has(section)
      )
    )
  ].sort();

  const query = new URLSearchParams();

  for (const section of selected) {
    query.set(section, "true");
  }

  const suffix = query.toString();

  const endpoint =
    "/v2/server" +
    (suffix ? `?${suffix}` : "");

  const cacheKey =
    `${guildId}:${endpoint}`;

  const cached = erlcCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.timestamp < 15000
  ) {
    return cached.data;
  }

  if (erlcPending.has(cacheKey)) {
    return erlcPending.get(cacheKey);
  }

  const pending = erlcRequest(
    guildId,
    endpoint
  )
    .then(data => {
      erlcCache.set(cacheKey, {
        timestamp: Date.now(),
        data
      });

      return data;
    })
    .finally(() => {
      erlcPending.delete(cacheKey);
    });

  erlcPending.set(
    cacheKey,
    pending
  );

  return pending;
}

// ============================================================
// 13. ER:LC DATA HELPERS
// ============================================================

function getErlcSection(data, sectionName) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return [];
  }

  return (
    data[sectionName] ??
    data[
      sectionName.charAt(0).toLowerCase() +
      sectionName.slice(1)
    ] ??
    []
  );
}

function getErlcEntries(data, sectionName) {
  const section = getErlcSection(
    data,
    sectionName
  );

  return Array.isArray(section)
    ? section
    : [];
}

function getErlcPlayerName(player) {
  if (typeof player === "string") {
    return player.split(":")[0];
  }

  if (
    !player ||
    typeof player !== "object"
  ) {
    return "Unknown";
  }

  const name =
    player.Player ??
    player.player ??
    player.Name ??
    player.name ??
    player.Username ??
    player.username ??
    "Unknown";

  return String(name).split(":")[0];
}

// ============================================================
// 14. ER:LC REMOTE COMMAND QUEUE
// ============================================================

async function sendErlcCommand(
  guildId,
  command
) {
  if (
    typeof command !== "string" ||
    command.length < 2 ||
    command.length > 180 ||
    /[\r\n]/.test(command) ||
    !/^:[a-zA-Z]/.test(command)
  ) {
    throw new Error(
      "Invalid ER:LC command."
    );
  }

  const previous =
    erlcCommandQueues.get(guildId) ||
    Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(async () => {
      // Conservative delay between
      // remote commands.
      await sleep(5500);

      return erlcRequest(
        guildId,
        "/v2/server/command",
        {
          method: "POST",

          body: {
            command
          }
        }
      );
    });

  erlcCommandQueues.set(
    guildId,
    current
  );

  current
    .finally(() => {
      if (
        erlcCommandQueues.get(guildId) ===
        current
      ) {
        erlcCommandQueues.delete(guildId);
      }
    })
    .catch(() => {});

  return current;
}

// ============================================================
// 15. DISCORD PERMISSIONS
// ============================================================

function hasManageGuild(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.ManageGuild
  );
}

function hasAdministrator(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

function hasConfiguredRole(
  member,
  roleId
) {
  return !!(
    roleId &&
    member.roles.cache.has(roleId)
  );
}

function getPermissionLevel(
  member,
  settings
) {
  if (
    member.guild.ownerId === member.id ||
    hasAdministrator(member) ||
    hasManageGuild(member)
  ) {
    return 3;
  }

  if (
    hasConfiguredRole(
      member,
      settings.roles.administrator
    )
  ) {
    return 3;
  }

  if (
    hasConfiguredRole(
      member,
      settings.roles.seniorStaff
    )
  ) {
    return 2;
  }

  if (
    hasConfiguredRole(
      member,
      settings.roles.staff
    )
  ) {
    return 1;
  }

  return 0;
}

const PERMISSION_LEVELS = {
  EVERYONE: 0,
  STAFF: 1,
  SENIOR_STAFF: 2,
  ADMINISTRATOR: 3
};

function hasVeyxPermission(
  member,
  settings,
  requiredLevel
) {
  return (
    getPermissionLevel(
      member,
      settings
    ) >= requiredLevel
  );
}

// ============================================================
// 16. SAFE DISCORD TEXT
// ============================================================

function escapeDiscordText(value) {
  return String(value ?? "")
    .replace(/@/g, "@\u200b")
    .replace(/```/g, "'''");
}

function truncateText(
  value,
  maximum = 3500
) {
  const text = String(value ?? "");

  if (text.length <= maximum) {
    return text;
  }

  return text.slice(
    0,
    maximum - 15
  ) + "\n...[truncated]";
}

// ============================================================
// 17. COMPONENTS V2 MESSAGE SYSTEM
//
// IMPORTANT:
//
// We intentionally DO NOT use
// ContainerBuilder here.
//
// TextDisplayBuilder + ActionRowBuilder
// produces Components V2 messages without
// a container accent-colored line.
//
// No traditional embeds are used.
// ============================================================

function veyxText(content) {
  return new TextDisplayBuilder()
    .setContent(
      truncateText(content, 3900)
    );
}

function veyxSeparator() {
  return new SeparatorBuilder();
}

function veyxButton(
  customId,
  label,
  style = ButtonStyle.Secondary,
  disabled = false
) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(
      String(label).slice(0, 80)
    )
    .setStyle(style)
    .setDisabled(disabled);
}

function veyxLinkButton(
  label,
  url
) {
  return new ButtonBuilder()
    .setLabel(
      String(label).slice(0, 80)
    )
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}

function veyxButtonRow(buttons) {
  if (
    !Array.isArray(buttons) ||
    buttons.length < 1 ||
    buttons.length > 5
  ) {
    throw new Error(
      "Button rows must contain 1-5 buttons."
    );
  }

  return new ActionRowBuilder()
    .addComponents(...buttons);
}

// ============================================================
// 18. COMPONENTS V2 MESSAGE BUILDER
// ============================================================

function buildVeyxMessage(options = {}) {
  const {
    title = "VEYX",
    description = "",
    sections = [],
    rows = [],
    footer = `VEYX / ${VEYX_VERSION}`
  } = options;

  const components = [];

  let header = `## ${escapeDiscordText(title)}`;

  if (description) {
    header +=
      `\n${escapeDiscordText(description)}`;
  }

  components.push(
    veyxText(header)
  );

  for (const section of sections) {
    if (components.length >= 35) {
      break;
    }

    components.push(
      veyxSeparator()
    );

    components.push(
      veyxText(
        escapeDiscordText(section)
      )
    );
  }

  for (const row of rows.slice(0, 5)) {
    components.push(row);
  }

  if (
    footer &&
    components.length < 40
  ) {
    components.push(
      veyxText(
        `-# ${escapeDiscordText(footer)}`
      )
    );
  }

  return {
    components,

    flags:
      MessageFlags.IsComponentsV2,

    allowedMentions: {
      parse: []
    }
  };
}

// ============================================================
// 19. SEND COMPONENTS V2 MESSAGE
// ============================================================

async function sendVeyxMessage(
  target,
  options = {}
) {
  const payload = buildVeyxMessage(
    options
  );

  // Supports:
  // Discord message replies
  // Discord text channels
  // Discord interactions

  if (
    target &&
    typeof target.reply === "function"
  ) {
    return target.reply(payload);
  }

  if (
    target &&
    typeof target.send === "function"
  ) {
    return target.send(payload);
  }

  throw new Error(
    "Invalid Veyx message target."
  );
}

// ============================================================
// 20. EDIT COMPONENTS V2 MESSAGE
// ============================================================

async function editVeyxMessage(
  message,
  options = {}
) {
  return message.edit(
    buildVeyxMessage(options)
  );
}

// ============================================================
// 21. SEND ERROR MESSAGE
// ============================================================

async function sendVeyxError(
  target,
  error
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return sendVeyxMessage(
    target,
    {
      title: "VEYX / ERROR",

      description:
        escapeDiscordText(message),

      footer:
        "VEYX / REQUEST FAILED"
    }
  );
}

// ============================================================
// 22. DISCORD CHANNEL HELPERS
// ============================================================

function getTextChannel(
  guild,
  channelId
) {
  if (!channelId) {
    return null;
  }

  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (
    !channel ||
    typeof channel.send !== "function"
  ) {
    return null;
  }

  return channel;
}

async function sendGuildAnnouncement(
  guild,
  channelId,
  options
) {
  const channel = getTextChannel(
    guild,
    channelId
  );

  if (!channel) {
    throw new Error(
      "Announcement channel is not configured or is unavailable."
    );
  }

  return sendVeyxMessage(
    channel,
    options
  );
}

// ============================================================
// 23. SESSION SETTINGS HELPERS
// ============================================================

function getSessionSettings(guildId) {
  return getGuildSettings(
    guildId
  ).sessions;
}

function getSessionMessages(guildId) {
  return getSessionSettings(
    guildId
  ).messages;
}

function getSessionButtons(guildId) {
  return getSessionSettings(
    guildId
  ).buttons;
}

function getSessionChannel(
  guild,
  type = "announcements"
) {
  const settings = getGuildSettings(
    guild.id
  );

  const channelId =
    type === "votes"
      ? (
          settings.channels.sessionVotes ||
          settings.channels.sessionAnnouncements
        )
      : settings.channels.sessionAnnouncements;

  return getTextChannel(
    guild,
    channelId
  );
}

// ============================================================
// 24. VOTE HELPERS
// ============================================================

function createVoteId() {
  return crypto.randomBytes(8)
    .toString("hex");
}

function countVotes(vote) {
  const values = Object.values(
    vote.voters || {}
  );

  return {
    yes: values.filter(
      value => value === "yes"
    ).length,

    no: values.filter(
      value => value === "no"
    ).length,

    total: values.length
  };
}

function getActiveVote(guildId) {
  const settings = getSessionSettings(
    guildId
  );

  const voteId =
    settings.activeVoteId;

  if (!voteId) {
    return null;
  }

  const vote =
    settings.votes[voteId];

  if (
    !vote ||
    vote.status !== "open"
  ) {
    return null;
  }

  return vote;
}

function hasVoteReachedTarget(
  guildId,
  vote
) {
  const settings =
    getSessionSettings(guildId);

  const counts =
    countVotes(vote);

  return (
    counts.yes >=
    settings.requiredVotes
  );
}

// ============================================================
// 25. STAFF SHIFT HELPERS
// ============================================================

function getActiveShift(
  guildId,
  userId
) {
  const settings =
    getGuildSettings(guildId);

  return (
    settings.staff.activeShifts[userId] ||
    null
  );
}

function getShiftDuration(shift) {
  if (!shift) {
    return 0;
  }

  const endTime =
    shift.pausedAt ||
    Date.now();

  return Math.max(
    0,
    endTime -
      shift.startedAt -
      (shift.pausedDuration || 0)
  );
}

function formatDuration(milliseconds) {
  const totalSeconds =
    Math.floor(milliseconds / 1000);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    totalSeconds % 60;

  return [
    `${hours}h`,
    `${minutes}m`,
    `${seconds}s`
  ].join(" ");
}

// ============================================================
// 26. COMMAND REGISTRY
//
// Commands will be registered in Part 2.
// ============================================================

const veyxCommands = new Map();

function registerVeyxCommand({
  name,
  description,
  permission = PERMISSION_LEVELS.EVERYONE,
  aliases = [],
  execute
}) {
  if (
    typeof name !== "string" ||
    typeof execute !== "function"
  ) {
    throw new Error(
      "Invalid Veyx command registration."
    );
  }

  const command = {
    name: name.toLowerCase(),
    description,
    permission,
    aliases,
    execute
  };

  veyxCommands.set(
    command.name,
    command
  );

  for (const alias of aliases) {
    veyxCommands.set(
      alias.toLowerCase(),
      command
    );
  }

  return command;
}

// ============================================================
// 27. COMMAND CONTEXT
// ============================================================

function createCommandContext(
  message,
  args
) {
  const guild = message.guild;

  if (!guild) {
    throw new Error(
      "Commands can only be used in Discord servers."
    );
  }

  const settings =
    getGuildSettings(guild.id);

  return {
    message,

    guild,

    member: message.member,

    user: message.author,

    args,

    settings,

    prefix: settings.prefix,

    reply: options =>
      sendVeyxMessage(
        message,
        options
      ),

    error: error =>
      sendVeyxError(
        message,
        error
      )
  };
}

// ============================================================
// 28. BASIC RATE LIMITING
// ============================================================

const commandCooldowns = new Map();

function checkCommandCooldown(
  guildId,
  userId,
  commandName,
  cooldownMs = 2500
) {
  const key =
    `${guildId}:${userId}:${commandName}`;

  const now = Date.now();

  const previous =
    commandCooldowns.get(key) || 0;

  const remaining =
    cooldownMs - (now - previous);

  if (remaining > 0) {
    return remaining;
  }

  commandCooldowns.set(
    key,
    now
  );

  return 0;
}

// ============================================================
// 29. FORMATTING HELPERS
// ============================================================

function formatList(
  entries,
  formatter,
  limit = 15
) {
  if (
    !Array.isArray(entries) ||
    entries.length === 0
  ) {
    return "No entries found.";
  }

  return entries
    .slice(0, limit)
    .map(formatter)
    .join("\n");
}

function formatNumber(value) {
  return Number(value || 0)
    .toLocaleString("en-US");
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }

  return new Date(
    timestamp
  ).toLocaleString("en-US");
}

// ============================================================
// END OF PART 1
//
// PART 2 WILL ADD:
//
// - Prefix command handler
// - Help command
// - ER:LC commands
// - Moderation commands
// - Staff commands
// - Roleplay commands
// - Components V2 button handlers
//
// DO NOT ADD client.login() HERE.
// DO NOT ADD app.listen() HERE.
//
// CONTINUE PART 2 DIRECTLY BELOW THIS LINE.
// ============================================================
// ============================================================
// VEYX v6.0
// PART 2 OF 5
//
// PREFIX COMMANDS
// ER:LC MANAGEMENT
// MODERATION
// STAFF SHIFTS
// COMPONENTS V2 INTERACTIONS
//
// Paste directly underneath Part 1.
// ============================================================

// ============================================================
// 30. COMMAND UTILITIES
// ============================================================

function requireArguments(ctx, count, usage) {
  if (ctx.args.length < count) {
    throw new Error(
      `Usage: ${ctx.prefix}${usage}`
    );
  }
}

function requireRobloxUsername(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_]{3,20}$/.test(value)
  ) {
    throw new Error(
      "Enter a valid Roblox username."
    );
  }

  return value;
}

function requireDiscordUser(ctx, argumentIndex = 0) {
  const raw = ctx.args[argumentIndex];

  if (!raw) {
    throw new Error(
      "Mention a Discord user or provide their user ID."
    );
  }

  const id = raw.replace(/[<@!>]/g, "");

  if (!/^\d{17,22}$/.test(id)) {
    throw new Error(
      "Invalid Discord user."
    );
  }

  return id;
}

function commandText(args, start = 0) {
  return args.slice(start).join(" ").trim();
}

function safeRemoteText(value, maximum = 120) {
  const text = String(value || "").trim();

  if (
    !text ||
    text.length > maximum ||
    /[\r\n]/.test(text)
  ) {
    throw new Error(
      `Text must contain 1-${maximum} characters on one line.`
    );
  }

  return text.replace(/@/g, "@\u200b");
}

function formatErlcPlayer(player, index) {
  const name = getErlcPlayerName(player);

  const team =
    player?.Team ??
    player?.team ??
    "Unknown";

  const callsign =
    player?.Callsign ??
    player?.callsign ??
    "None";

  return (
    `**${index + 1}. ${escapeDiscordText(name)}**\n` +
    `Team: ${escapeDiscordText(team)} | ` +
    `Callsign: ${escapeDiscordText(callsign)}`
  );
}

function getCommandName(input) {
  const match = input.match(/^([^\s]+)/);

  return match
    ? match[1].toLowerCase()
    : "";
}

// ============================================================
// 31. COMPONENTS V2 RESPONSE HELPERS
// ============================================================

async function commandReply(
  ctx,
  title,
  description,
  sections = [],
  rows = []
) {
  return ctx.reply({
    title,
    description,
    sections,
    rows
  });
}

async function commandSuccess(
  ctx,
  title,
  description
) {
  return commandReply(
    ctx,
    `VEYX / ${title}`,
    description
  );
}

async function commandFailure(
  ctx,
  description
) {
  return commandReply(
    ctx,
    "VEYX / REQUEST FAILED",
    description
  );
}

// ============================================================
// 32. ER:LC REMOTE COMMAND EXECUTOR
// ============================================================

async function executeRemoteCommand(
  ctx,
  command,
  auditType = "REMOTE_COMMAND"
) {
  const result = await sendErlcCommand(
    ctx.guild.id,
    command
  );

  ctx.settings.statistics.remoteCommands++;

  addAuditEvent(
    ctx.guild.id,
    auditType,
    `${ctx.user.id} executed ${command}`,
    ctx.user.id
  );

  saveDatabase();

  return commandSuccess(
    ctx,
    "COMMAND SUBMITTED",
    [
      `**Command**`,
      `\`${escapeDiscordText(command)}\``,
      "",
      `**Result**`,
      escapeDiscordText(
        result?.message ||
        "Request accepted by the ER:LC API."
      )
    ].join("\n")
  );
}

// ============================================================
// 33. HELP COMMAND
// ============================================================

registerVeyxCommand({
  name: "help",

  aliases: ["commands", "cmds"],

  description: "View all available Veyx commands.",

  async execute(ctx) {
    const unique = new Map();

    for (const command of veyxCommands.values()) {
      unique.set(
        command.name,
        command
      );
    }

    const permitted = [...unique.values()]
      .filter(command =>
        hasVeyxPermission(
          ctx.member,
          ctx.settings,
          command.permission
        )
      );

    const categories = {
      "ER:LC INFORMATION": [
        "erlc",
        "server",
        "players",
        "player",
        "staff",
        "queue",
        "vehicles",
        "joinlogs",
        "killlogs",
        "commandlogs",
        "modcalls",
        "emergencycalls"
      ],

      "ER:LC MANAGEMENT": [
        "kick",
        "ban",
        "unban",
        "kill",
        "heal",
        "bring",
        "respawn",
        "announce",
        "hint",
        "pm",
        "priority",
        "peacetime",
        "command"
      ],

      "MODERATION": [
        "warn",
        "warnings",
        "unwarn",
        "note",
        "notes",
        "bolo",
        "case"
      ],

      "STAFF MANAGEMENT": [
        "shift",
        "stafftop",
        "staffstats"
      ],

      "SESSIONS": [
        "ssu",
        "ssd",
        "svote",
        "boost",
        "session"
      ],

      "UTILITIES": [
        "help",
        "ping",
        "botinfo",
        "dashboard",
        "prefix",
        "stats",
        "logs"
      ]
    };

    const sections = [];

    for (const [category, names] of Object.entries(categories)) {
      const found = names
        .map(name => permitted.find(
          command => command.name === name
        ))
        .filter(Boolean);

      if (!found.length) {
        continue;
      }

      const content = found
        .map(command =>
          `\`${ctx.prefix}${command.name}\` — ` +
          escapeDiscordText(command.description)
        )
        .join("\n");

      sections.push(
        `### ${category}\n${content}`
      );
    }

    const rows = [
      veyxButtonRow([
        veyxButton(
          "veyx:help:refresh",
          "Refresh Commands"
        ),

        veyxLinkButton(
          "Dashboard",
          `${BASE_URL}/dashboard`
        )
      ])
    ];

    return commandReply(
      ctx,
      "VEYX / COMMAND CENTER",
      [
        `**Server:** ${escapeDiscordText(ctx.guild.name)}`,
        `**Prefix:** \`${ctx.prefix}\``,
        "",
        "Your available commands are listed below."
      ].join("\n"),
      sections,
      rows
    );
  }
});

// ============================================================
// 34. BASIC UTILITY COMMANDS
// ============================================================

registerVeyxCommand({
  name: "ping",

  description: "Check Veyx latency.",

  async execute(ctx) {
    return commandSuccess(
      ctx,
      "PING",
      [
        `**Gateway:** ${Math.round(client.ws.ping)}ms`,
        `**Uptime:** ${formatDuration(process.uptime() * 1000)}`
      ].join("\n")
    );
  }
});

registerVeyxCommand({
  name: "botinfo",

  aliases: ["about"],

  description: "View Veyx information.",

  async execute(ctx) {
    return commandSuccess(
      ctx,
      "BOT INFORMATION",
      [
        `**Name:** VEYX`,
        `**Version:** ${VEYX_VERSION}`,
        `**Discord Servers:** ${formatNumber(client.guilds.cache.size)}`,
        `**Uptime:** ${formatDuration(process.uptime() * 1000)}`,
        `**Website:** ${BASE_URL}`
      ].join("\n")
    );
  }
});

registerVeyxCommand({
  name: "dashboard",

  aliases: ["dash"],

  description: "Open the Veyx dashboard.",

  async execute(ctx) {
    return ctx.reply({
      title: "VEYX / DASHBOARD",

      description:
        "Manage your ER:LC server, command prefix, permissions, logging and sessions.",

      rows: [
        veyxButtonRow([
          veyxLinkButton(
            "Open Dashboard",
            `${BASE_URL}/dashboard`
          )
        ])
      ]
    });
  }
});

registerVeyxCommand({
  name: "prefix",

  description: "View your server's command prefix.",

  async execute(ctx) {
    return commandSuccess(
      ctx,
      "COMMAND PREFIX",
      [
        `**Current Prefix:** \`${ctx.prefix}\``,
        "",
        "Change the prefix through the Veyx dashboard.",
        "",
        `Example: \`${ctx.prefix}help\``
      ].join("\n")
    );
  }
});

// ============================================================
// 35. ER:LC MAIN PANEL
// ============================================================

registerVeyxCommand({
  name: "erlc",

  aliases: ["panel"],

  description: "Open the ER:LC management panel.",

  async execute(ctx) {
    const connected =
      !!ctx.settings.apiKeyEncrypted;

    return ctx.reply({
      title: "VEYX / ER:LC MANAGEMENT",

      description: [
        `**Server:** ${escapeDiscordText(ctx.guild.name)}`,
        `**Connection:** ${connected ? "CONNECTED" : "NOT CONNECTED"}`,
        `**Prefix:** \`${ctx.prefix}\``,
        "",
        "Use the buttons below to view your ER:LC server."
      ].join("\n"),

      rows: [
        veyxButtonRow([
          veyxButton(
            "veyx:erlc:players",
            "Players"
          ),

          veyxButton(
            "veyx:erlc:staff",
            "Staff"
          ),

          veyxButton(
            "veyx:erlc:queue",
            "Queue"
          ),

          veyxButton(
            "veyx:erlc:server",
            "Server"
          )
        ]),

        veyxButtonRow([
          veyxButton(
            "veyx:erlc:refresh",
            "Refresh",
            ButtonStyle.Primary
          ),

          veyxLinkButton(
            "Dashboard",
            `${BASE_URL}/dashboard`
          )
        ])
      ]
    });
  }
});

// ============================================================
// 36. ER:LC SERVER INFORMATION
// ============================================================

registerVeyxCommand({
  name: "server",

  aliases: [
    "serverinfo",
    "status"
  ],

  description: "View ER:LC server information.",

  async execute(ctx) {
    const data = await getErlcServer(
      ctx.guild.id
    );

    return commandSuccess(
      ctx,
      "SERVER INFORMATION",
      [
        `**Name:** ${escapeDiscordText(data.Name || data.name || "Unknown")}`,
        `**Players:** ${escapeDiscordText(data.CurrentPlayers ?? "Unknown")}`,
        `**Maximum Players:** ${escapeDiscordText(data.MaxPlayers ?? "Unknown")}`,
        `**Join Code:** ${escapeDiscordText(data.JoinKey || "Unavailable")}`
      ].join("\n")
    );
  }
});

// ============================================================
// 37. ER:LC PLAYERS
// ============================================================

registerVeyxCommand({
  name: "players",

  aliases: ["online"],

  description: "View online ER:LC players.",

  async execute(ctx) {
    const data = await getErlcServer(
      ctx.guild.id,
      ["Players"]
    );

    const players = getErlcEntries(
      data,
      "Players"
    );

    return commandReply(
      ctx,
      "VEYX / ONLINE PLAYERS",
      [
        `**Players Online:** ${players.length}`,
        "",
        formatList(
          players,
          formatErlcPlayer,
          20
        )
      ].join("\n")
    );
  }
});

registerVeyxCommand({
  name: "player",

  description: "Look up an ER:LC player.",

  async execute(ctx) {
    requireArguments(
      ctx,
      1,
      "player <username>"
    );

    const query = commandText(
      ctx.args
    ).toLowerCase();

    const data = await getErlcServer(
      ctx.guild.id,
      ["Players"]
    );

    const players = getErlcEntries(
      data,
      "Players"
    );

    const player = players.find(item =>
      getErlcPlayerName(item)
        .toLowerCase()
        .includes(query)
    );

    if (!player) {
      return commandFailure(
        ctx,
        "That player was not found in the ER:LC server."
      );
    }

    const fields = [
      `**Username:** ${escapeDiscordText(getErlcPlayerName(player))}`,
      `**Team:** ${escapeDiscordText(player.Team || "Unknown")}`,
      `**Callsign:** ${escapeDiscordText(player.Callsign || "None")}`,
      `**Permission:** ${escapeDiscordText(player.Permission || "Unknown")}`
    ];

    return commandReply(
      ctx,
      "VEYX / PLAYER INFORMATION",
      fields.join("\n")
    );
  }
});

// ============================================================
// 38. ER:LC STAFF
// ============================================================

registerVeyxCommand({
  name: "staff",

  description: "View ER:LC staff information.",

  async execute(ctx) {
    const data = await getErlcServer(
      ctx.guild.id,
      ["Staff"]
    );

    const staff = getErlcSection(
      data,
      "Staff"
    );

    const formatted =
      typeof staff === "object"
        ? JSON.stringify(staff, null, 2)
        : String(staff);

    return commandReply(
      ctx,
      "VEYX / ER:LC STAFF",
      `\`\`\`json\n${truncateText(formatted, 2800)}\n\`\`\``
    );
  }
});

// ============================================================
// 39. ER:LC QUEUE
// ============================================================

registerVeyxCommand({
  name: "queue",

  description: "View the ER:LC server queue.",

  async execute(ctx) {
    const data = await getErlcServer(
      ctx.guild.id,
      ["Queue"]
    );

    const queue = getErlcEntries(
      data,
      "Queue"
    );

    return commandReply(
      ctx,
      "VEYX / SERVER QUEUE",
      [
        `**Queue Size:** ${queue.length}`,
        "",
        formatList(
          queue,
          (player, index) =>
            `${index + 1}. ${escapeDiscordText(getErlcPlayerName(player))}`
        )
      ].join("\n")
    );
  }
});

// ============================================================
// 40. ER:LC VEHICLES
// ============================================================

registerVeyxCommand({
  name: "vehicles",

  description: "View active ER:LC vehicles.",

  async execute(ctx) {
    const data = await getErlcServer(
      ctx.guild.id,
      ["Vehicles"]
    );

    const vehicles = getErlcEntries(
      data,
      "Vehicles"
    );

    return commandReply(
      ctx,
      "VEYX / VEHICLES",
      [
        `**Vehicles:** ${vehicles.length}`,
        "",
        formatList(
          vehicles,
          (vehicle, index) =>
            `${index + 1}. ${escapeDiscordText(
              vehicle.Name ||
              vehicle.Model ||
              vehicle.Vehicle ||
              "Unknown Vehicle"
            )}`
        )
      ].join("\n")
    );
  }
});

// ============================================================
// 41. ER:LC LOG COMMANDS
// ============================================================

function registerErlcLogCommand(
  name,
  section,
  description
) {
  registerVeyxCommand({
    name,
    description,

    permission:
      PERMISSION_LEVELS.STAFF,

    async execute(ctx) {
      const data = await getErlcServer(
        ctx.guild.id,
        [section]
      );

      const entries = getErlcEntries(
        data,
        section
      );

      const output = formatList(
        entries,
        (entry, index) =>
          `${index + 1}. ${escapeDiscordText(
            JSON.stringify(entry)
          )}`,
        12
      );

      return commandReply(
        ctx,
        `VEYX / ${section.toUpperCase()}`,
        truncateText(output, 3200)
      );
    }
  });
}

registerErlcLogCommand(
  "joinlogs",
  "JoinLogs",
  "View ER:LC join and leave logs."
);

registerErlcLogCommand(
  "killlogs",
  "KillLogs",
  "View ER:LC kill logs."
);

registerErlcLogCommand(
  "commandlogs",
  "CommandLogs",
  "View ER:LC command logs."
);

registerErlcLogCommand(
  "modcalls",
  "ModCalls",
  "View ER:LC moderation calls."
);

registerErlcLogCommand(
  "emergencycalls",
  "EmergencyCalls",
  "View ER:LC emergency calls."
);

// ============================================================
// 42. ER:LC REMOTE COMMAND REGISTRATION
// ============================================================

function registerRemoteCommand({
  name,
  description,
  permission = PERMISSION_LEVELS.STAFF,
  build
}) {
  registerVeyxCommand({
    name,
    description,
    permission,

    async execute(ctx) {
      requireArguments(
        ctx,
        1,
        `${name} <arguments>`
      );

      const remoteCommand = build(
        ctx.args
      );

      return executeRemoteCommand(
        ctx,
        remoteCommand
      );
    }
  });
}

// ============================================================
// 43. ER:LC MODERATION COMMANDS
// ============================================================

registerRemoteCommand({
  name: "kick",

  description: "Kick a player from ER:LC.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  build(args) {
    const username = requireRobloxUsername(
      args[0]
    );

    const reason =
      commandText(args, 1) ||
      "Staff decision";

    return (
      `:kick ${username} ` +
      safeRemoteText(reason, 90)
    );
  }
});

registerRemoteCommand({
  name: "ban",

  description: "Ban an ER:LC player.",

  permission:
    PERMISSION_LEVELS.ADMINISTRATOR,

  build(args) {
    return (
      `:ban ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "unban",

  description: "Unban an ER:LC player.",

  permission:
    PERMISSION_LEVELS.ADMINISTRATOR,

  build(args) {
    return (
      `:unban ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "kill",

  description: "Kill an ER:LC player.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  build(args) {
    return (
      `:kill ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "heal",

  description: "Heal an ER:LC player.",

  build(args) {
    return (
      `:heal ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "bring",

  description: "Bring an ER:LC player.",

  build(args) {
    return (
      `:bring ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "respawn",

  description: "Respawn an ER:LC player.",

  build(args) {
    return (
      `:respawn ${requireRobloxUsername(args[0])}`
    );
  }
});

registerRemoteCommand({
  name: "announce",

  description: "Send an ER:LC announcement.",

  build(args) {
    return (
      `:m ${safeRemoteText(
        commandText(args),
        150
      )}`
    );
  }
});

registerRemoteCommand({
  name: "hint",

  description: "Send an ER:LC hint.",

  build(args) {
    return (
      `:h ${safeRemoteText(
        commandText(args),
        150
      )}`
    );
  }
});

registerRemoteCommand({
  name: "pm",

  description: "Send a private ER:LC message.",

  build(args) {
    if (args.length < 2) {
      throw new Error(
        "Usage: pm <username> <message>"
      );
    }

    const username =
      requireRobloxUsername(args[0]);

    const message =
      safeRemoteText(
        commandText(args, 1),
        120
      );

    return (
      `:pm ${username} ${message}`
    );
  }
});

registerRemoteCommand({
  name: "priority",

  description: "Manage ER:LC priority status.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  build(args) {
    return (
      `:priority ${safeRemoteText(
        commandText(args),
        100
      )}`
    );
  }
});

registerRemoteCommand({
  name: "peacetime",

  description: "Manage ER:LC peacetime.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  build(args) {
    return (
      `:peacetime ${safeRemoteText(
        commandText(args),
        100
      )}`
    );
  }
});

// ============================================================
// 44. CUSTOM REMOTE COMMAND
// ============================================================

registerVeyxCommand({
  name: "command",

  aliases: ["cmd"],

  description: "Execute an ER:LC server command.",

  permission:
    PERMISSION_LEVELS.ADMINISTRATOR,

  async execute(ctx) {
    requireArguments(
      ctx,
      1,
      "command :<erlc-command>"
    );

    const command =
      commandText(ctx.args);

    if (
      !/^:[a-zA-Z][a-zA-Z0-9]*(?:\s|$)/.test(command)
    ) {
      throw new Error(
        "ER:LC commands must begin with a colon."
      );
    }

    return executeRemoteCommand(
      ctx,
      command,
      "CUSTOM_REMOTE_COMMAND"
    );
  }
});

// ============================================================
// 45. DISCORD WARNING SYSTEM
// ============================================================

registerVeyxCommand({
  name: "warn",

  description: "Warn a Discord member.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    requireArguments(
      ctx,
      2,
      "warn @user <reason>"
    );

    const userId =
      requireDiscordUser(ctx);

    const reason =
      safeRemoteText(
        commandText(ctx.args, 1),
        300
      );

    const warnings =
      ctx.settings.moderation.warnings;

    if (!warnings[userId]) {
      warnings[userId] = [];
    }

    const warning = {
      id: crypto.randomBytes(4)
        .toString("hex"),

      reason,

      moderatorId: ctx.user.id,

      timestamp: Date.now()
    };

    warnings[userId].push(warning);

    ctx.settings.statistics.warningsIssued++;

    addAuditEvent(
      ctx.guild.id,
      "WARNING",
      `User ${userId}: ${reason}`,
      ctx.user.id
    );

    saveDatabase();

    return commandSuccess(
      ctx,
      "WARNING ISSUED",
      [
        `**User:** <@${userId}>`,
        `**Reason:** ${escapeDiscordText(reason)}`,
        `**Case ID:** \`${warning.id}\``
      ].join("\n")
    );
  }
});

// ============================================================
// 46. VIEW WARNINGS
// ============================================================

registerVeyxCommand({
  name: "warnings",

  description: "View a member's warnings.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    requireArguments(
      ctx,
      1,
      "warnings @user"
    );

    const userId =
      requireDiscordUser(ctx);

    const warnings =
      ctx.settings.moderation.warnings[userId] ||
      [];

    return commandReply(
      ctx,
      "VEYX / WARNINGS",
      [
        `**User:** <@${userId}>`,
        `**Total Warnings:** ${warnings.length}`,
        "",
        formatList(
          warnings,
          warning =>
            `**${warning.id}** — ` +
            escapeDiscordText(warning.reason)
        )
      ].join("\n")
    );
  }
});

// ============================================================
// 47. REMOVE WARNING
// ============================================================

registerVeyxCommand({
  name: "unwarn",

  description: "Remove a warning by ID.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  async execute(ctx) {
    requireArguments(
      ctx,
      1,
      "unwarn <warning-id>"
    );

    const warningId =
      ctx.args[0];

    const allWarnings =
      ctx.settings.moderation.warnings;

    for (const warnings of Object.values(allWarnings)) {
      const index = warnings.findIndex(
        warning => warning.id === warningId
      );

      if (index !== -1) {
        warnings.splice(index, 1);

        saveDatabase();

        return commandSuccess(
          ctx,
          "WARNING REMOVED",
          `Warning \`${warningId}\` was removed.`
        );
      }
    }

    return commandFailure(
      ctx,
      "Warning not found."
    );
  }
});

// ============================================================
// 48. STAFF NOTES
// ============================================================

registerVeyxCommand({
  name: "note",

  description: "Add a staff note about a user.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    requireArguments(
      ctx,
      2,
      "note @user <text>"
    );

    const userId =
      requireDiscordUser(ctx);

    const text =
      safeRemoteText(
        commandText(ctx.args, 1),
        300
      );

    const notes =
      ctx.settings.moderation.notes;

    if (!notes[userId]) {
      notes[userId] = [];
    }

    notes[userId].push({
      id: crypto.randomBytes(4)
        .toString("hex"),

      text,

      moderatorId: ctx.user.id,

      timestamp: Date.now()
    });

    saveDatabase();

    return commandSuccess(
      ctx,
      "STAFF NOTE ADDED",
      `A staff note was added for <@${userId}>.`
    );
  }
});

registerVeyxCommand({
  name: "notes",

  description: "View staff notes for a user.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    requireArguments(
      ctx,
      1,
      "notes @user"
    );

    const userId =
      requireDiscordUser(ctx);

    const notes =
      ctx.settings.moderation.notes[userId] ||
      [];

    return commandReply(
      ctx,
      "VEYX / STAFF NOTES",
      [
        `**User:** <@${userId}>`,
        "",
        formatList(
          notes,
          note =>
            `**${note.id}** — ` +
            escapeDiscordText(note.text)
        )
      ].join("\n")
    );
  }
});

// ============================================================
// 49. BOLO SYSTEM
// ============================================================

registerVeyxCommand({
  name: "bolo",

  description: "Create, list or remove BOLO records.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const action =
      (ctx.args[0] || "list").toLowerCase();

    const bolos =
      ctx.settings.moderation.bolos;

    if (action === "create") {
      const text =
        safeRemoteText(
          commandText(ctx.args, 1),
          300
        );

      const bolo = {
        id: crypto.randomBytes(4)
          .toString("hex"),

        text,

        createdBy: ctx.user.id,

        createdAt: Date.now()
      };

      bolos.push(bolo);

      saveDatabase();

      return commandSuccess(
        ctx,
        "BOLO CREATED",
        [
          `**ID:** \`${bolo.id}\``,
          `**Description:** ${escapeDiscordText(text)}`
        ].join("\n")
      );
    }

    if (action === "remove") {
      const id = ctx.args[1];

      const index =
        bolos.findIndex(
          bolo => bolo.id === id
        );

      if (index === -1) {
        throw new Error(
          "BOLO not found."
        );
      }

      bolos.splice(index, 1);

      saveDatabase();

      return commandSuccess(
        ctx,
        "BOLO REMOVED",
        `BOLO \`${id}\` was removed.`
      );
    }

    return commandReply(
      ctx,
      "VEYX / ACTIVE BOLOS",
      formatList(
        bolos,
        bolo =>
          `**${bolo.id}** — ` +
          escapeDiscordText(bolo.text)
      )
    );
  }
});

// ============================================================
// 50. MODERATION CASES
// ============================================================

registerVeyxCommand({
  name: "case",

  description: "Create, view or close moderation cases.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const action =
      (ctx.args[0] || "list").toLowerCase();

    const cases =
      ctx.settings.moderation.cases;

    if (action === "create") {
      if (ctx.args.length < 3) {
        throw new Error(
          "Usage: case create @user <reason>"
        );
      }

      const userId =
        requireDiscordUser(
          {
            ...ctx,
            args: ctx.args.slice(1)
          }
        );

      const reason =
        safeRemoteText(
          commandText(ctx.args, 2),
          300
        );

      const record = {
        id: crypto.randomBytes(4)
          .toString("hex"),

        userId,

        reason,

        createdBy: ctx.user.id,

        createdAt: Date.now(),

        status: "open"
      };

      cases.push(record);

      saveDatabase();

      return commandSuccess(
        ctx,
        "CASE CREATED",
        [
          `**Case ID:** \`${record.id}\``,
          `**User:** <@${userId}>`,
          `**Reason:** ${escapeDiscordText(reason)}`
        ].join("\n")
      );
    }

    if (action === "view") {
      const record =
        cases.find(
          item => item.id === ctx.args[1]
        );

      if (!record) {
        throw new Error(
          "Case not found."
        );
      }

      return commandReply(
        ctx,
        "VEYX / MODERATION CASE",
        [
          `**Case ID:** \`${record.id}\``,
          `**User:** <@${record.userId}>`,
          `**Status:** ${record.status}`,
          `**Reason:** ${escapeDiscordText(record.reason)}`,
          `**Created:** ${formatTimestamp(record.createdAt)}`
        ].join("\n")
      );
    }

    if (action === "close") {
      const record =
        cases.find(
          item => item.id === ctx.args[1]
        );

      if (!record) {
        throw new Error(
          "Case not found."
        );
      }

      record.status = "closed";
      record.closedBy = ctx.user.id;
      record.closedAt = Date.now();

      saveDatabase();

      return commandSuccess(
        ctx,
        "CASE CLOSED",
        `Case \`${record.id}\` has been closed.`
      );
    }

    return commandReply(
      ctx,
      "VEYX / MODERATION CASES",
      formatList(
        cases.slice().reverse(),
        record =>
          `**${record.id}** — ${record.status} — ` +
          escapeDiscordText(record.reason)
      )
    );
  }
});

// ============================================================
// 51. STAFF SHIFT MANAGEMENT
// ============================================================

registerVeyxCommand({
  name: "shift",

  description: "Start, pause, resume or end staff shifts.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const action =
      (ctx.args[0] || "status").toLowerCase();

    const shifts =
      ctx.settings.staff.activeShifts;

    const totals =
      ctx.settings.staff.shiftTotals;

    const userId =
      ctx.user.id;

    const shift =
      shifts[userId];

    if (action === "start") {
      if (shift) {
        throw new Error(
          "You already have an active shift."
        );
      }

      shifts[userId] = {
        startedAt: Date.now(),

        pausedAt: null,

        pausedDuration: 0
      };

      saveDatabase();

      return commandSuccess(
        ctx,
        "SHIFT STARTED",
        "Your staff shift has started."
      );
    }

    if (action === "pause") {
      if (!shift) {
        throw new Error(
          "You do not have an active shift."
        );
      }

      if (shift.pausedAt) {
        throw new Error(
          "Your shift is already paused."
        );
      }

      shift.pausedAt = Date.now();

      saveDatabase();

      return commandSuccess(
        ctx,
        "SHIFT PAUSED",
        "Your staff shift has been paused."
      );
    }

    if (action === "resume") {
      if (!shift || !shift.pausedAt) {
        throw new Error(
          "You do not have a paused shift."
        );
      }

      shift.pausedDuration +=
        Date.now() - shift.pausedAt;

      shift.pausedAt = null;

      saveDatabase();

      return commandSuccess(
        ctx,
        "SHIFT RESUMED",
        "Your staff shift has resumed."
      );
    }

    if (action === "end") {
      if (!shift) {
        throw new Error(
          "You do not have an active shift."
        );
      }

      const duration =
        getShiftDuration(shift);

      totals[userId] =
        (totals[userId] || 0) +
        duration;

      ctx.settings.staff.shiftHistory.push({
        userId,

        startedAt: shift.startedAt,

        endedAt: Date.now(),

        duration
      });

      delete shifts[userId];

      saveDatabase();

      return commandSuccess(
        ctx,
        "SHIFT ENDED",
        [
          "**Your staff shift has ended.**",
          "",
          `**Duration:** ${formatDuration(duration)}`
        ].join("\n")
      );
    }

    if (action === "active") {
      const active =
        Object.entries(shifts);

      return commandReply(
        ctx,
        "VEYX / ACTIVE STAFF SHIFTS",
        formatList(
          active,
          ([id, data]) =>
            `**<@${id}>** — ` +
            formatDuration(
              getShiftDuration(data)
            )
        )
      );
    }

    if (action === "status") {
      if (!shift) {
        return commandSuccess(
          ctx,
          "SHIFT STATUS",
          "You do not have an active staff shift."
        );
      }

      return commandReply(
        ctx,
        "VEYX / SHIFT STATUS",
        [
          `**Status:** ${shift.pausedAt ? "PAUSED" : "ACTIVE"}`,
          `**Duration:** ${formatDuration(getShiftDuration(shift))}`
        ].join("\n")
      );
    }

    throw new Error(
      "Usage: shift start | pause | resume | end | active | status"
    );
  }
});

// ============================================================
// 52. STAFF LEADERBOARD
// ============================================================

registerVeyxCommand({
  name: "stafftop",

  description: "View the staff shift leaderboard.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const totals =
      Object.entries(
        ctx.settings.staff.shiftTotals
      );

    totals.sort(
      (a, b) => b[1] - a[1]
    );

    return commandReply(
      ctx,
      "VEYX / STAFF LEADERBOARD",
      formatList(
        totals,
        ([userId, duration], index) =>
          `**${index + 1}. <@${userId}>** — ` +
          formatDuration(duration)
      )
    );
  }
});

// ============================================================
// 53. STAFF STATISTICS
// ============================================================

registerVeyxCommand({
  name: "staffstats",

  description: "View staff shift statistics.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const userId =
      ctx.args[0]
        ? requireDiscordUser(ctx)
        : ctx.user.id;

    const total =
      ctx.settings.staff.shiftTotals[userId] ||
      0;

    const active =
      ctx.settings.staff.activeShifts[userId];

    return commandReply(
      ctx,
      "VEYX / STAFF STATISTICS",
      [
        `**User:** <@${userId}>`,
        `**Total Shift Time:** ${formatDuration(total)}`,
        `**Active Shift:** ${active ? "YES" : "NO"}`
      ].join("\n")
    );
  }
});

// ============================================================
// 54. VEYX STATISTICS
// ============================================================

registerVeyxCommand({
  name: "stats",

  description: "View Veyx server statistics.",

  async execute(ctx) {
    const stats =
      ctx.settings.statistics;

    return commandReply(
      ctx,
      "VEYX / SERVER STATISTICS",
      [
        `**Commands Executed:** ${formatNumber(stats.commandsExecuted)}`,
        `**Remote Commands:** ${formatNumber(stats.remoteCommands)}`,
        `**Warnings Issued:** ${formatNumber(stats.warningsIssued)}`,
        `**Sessions Started:** ${formatNumber(stats.sessionsStarted)}`,
        `**Sessions Ended:** ${formatNumber(stats.sessionsEnded)}`,
        `**Votes Created:** ${formatNumber(stats.votesCreated)}`,
        `**Votes Approved:** ${formatNumber(stats.votesApproved)}`,
        `**Votes Failed:** ${formatNumber(stats.votesFailed)}`
      ].join("\n")
    );
  }
});

// ============================================================
// 55. VEYX AUDIT LOGS
// ============================================================

registerVeyxCommand({
  name: "logs",

  description: "View recent Veyx activity.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const events =
      ctx.settings.events.slice(0, 15);

    return commandReply(
      ctx,
      "VEYX / ACTIVITY LOGS",
      formatList(
        events,
        event =>
          `**${escapeDiscordText(event.type)}**\n` +
          `${escapeDiscordText(event.description)}\n` +
          `-# ${formatTimestamp(event.timestamp)}`
      )
    );
  }
});

// ============================================================
// 56. PREFIX COMMAND HANDLER
// ============================================================

client.on(
  Events.MessageCreate,
  async message => {
    if (
      !message.guild ||
      message.author.bot ||
      !message.member
    ) {
      return;
    }

    const settings =
      getGuildSettings(message.guild.id);

    const prefix =
      settings.prefix;

    if (
      !message.content.startsWith(prefix)
    ) {
      return;
    }

    const input =
      message.content
        .slice(prefix.length)
        .trim();

    if (!input) {
      return;
    }

    const parts =
      input.match(
        /"[^"]*"|'[^']*'|\S+/g
      ) || [];

    const commandName =
      (parts.shift() || "")
        .toLowerCase();

    const command =
      veyxCommands.get(commandName);

    if (!command) {
      return;
    }

    const args =
      parts.map(value =>
        value.replace(
          /^["']|["']$/g,
          ""
        )
      );

    const ctx =
      createCommandContext(
        message,
        args
      );

    if (
      !hasVeyxPermission(
        message.member,
        settings,
        command.permission
      )
    ) {
      await commandFailure(
        ctx,
        "You do not have permission to use this command."
      ).catch(() => {});

      return;
    }

    const cooldown =
      checkCommandCooldown(
        message.guild.id,
        message.author.id,
        command.name
      );

    if (cooldown > 0) {
      return;
    }

    try {
      await command.execute(ctx);

      settings.statistics.commandsExecuted++;

      saveDatabase();
    } catch (error) {
      console.error(
        `[VEYX COMMAND] ${command.name}:`,
        error
      );

      await sendVeyxError(
        message,
        error
      ).catch(() => {});
    }
  }
);

// ============================================================
// 57. COMPONENTS V2 INTERACTION HELPERS
// ============================================================

async function replyInteractionV2(
  interaction,
  options = {},
  ephemeral = true
) {
  const payload =
    buildVeyxMessage(options);

  if (ephemeral) {
    payload.flags =
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral;
  }

  return interaction.reply(payload);
}

async function updateInteractionV2(
  interaction,
  options = {}
) {
  return interaction.update(
    buildVeyxMessage(options)
  );
}

async function editInteractionV2(
  interaction,
  options = {}
) {
  return interaction.editReply(
    buildVeyxMessage(options)
  );
}

// ============================================================
// 58. ER:LC PANEL BUTTONS
// ============================================================

async function handleErlcPanelButton(
  interaction
) {
  const action =
    interaction.customId.split(":")[2];

  if (action === "refresh") {
    const settings =
      getGuildSettings(
        interaction.guild.id
      );

    return updateInteractionV2(
      interaction,
      {
        title:
          "VEYX / ER:LC MANAGEMENT",

        description: [
          `**Server:** ${escapeDiscordText(interaction.guild.name)}`,
          `**Connection:** ${settings.apiKeyEncrypted ? "CONNECTED" : "NOT CONNECTED"}`,
          `**Prefix:** \`${settings.prefix}\``,
          "",
          "Server panel refreshed."
        ].join("\n"),

        rows: [
          veyxButtonRow([
            veyxButton(
              "veyx:erlc:players",
              "Players"
            ),

            veyxButton(
              "veyx:erlc:staff",
              "Staff"
            ),

            veyxButton(
              "veyx:erlc:queue",
              "Queue"
            ),

            veyxButton(
              "veyx:erlc:server",
              "Server"
            )
          ]),

          veyxButtonRow([
            veyxButton(
              "veyx:erlc:refresh",
              "Refresh",
              ButtonStyle.Primary
            ),

            veyxLinkButton(
              "Dashboard",
              `${BASE_URL}/dashboard`
            )
          ])
        ]
      }
    );
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    let title;
    let description;

    if (action === "server") {
      const data =
        await getErlcServer(
          interaction.guild.id
        );

      title =
        "VEYX / SERVER INFORMATION";

      description = [
        `**Name:** ${escapeDiscordText(data.Name || "Unknown")}`,
        `**Players:** ${escapeDiscordText(data.CurrentPlayers ?? "Unknown")}`,
        `**Maximum:** ${escapeDiscordText(data.MaxPlayers ?? "Unknown")}`,
        `**Join Code:** ${escapeDiscordText(data.JoinKey || "Unavailable")}`
      ].join("\n");
    } else {
      const sections = {
        players: "Players",
        staff: "Staff",
        queue: "Queue"
      };

      const section =
        sections[action];

      if (!section) {
        throw new Error(
          "Unknown panel action."
        );
      }

      const data =
        await getErlcServer(
          interaction.guild.id,
          [section]
        );

      const value =
        getErlcSection(
          data,
          section
        );

      title =
        `VEYX / ${section.toUpperCase()}`;

      if (Array.isArray(value)) {
        description =
          formatList(
            value,
            (entry, index) =>
              `${index + 1}. ${escapeDiscordText(
                section === "Players"
                  ? getErlcPlayerName(entry)
                  : typeof entry === "object"
                    ? JSON.stringify(entry)
                    : entry
              )}`
          );
      } else {
        description =
          JSON.stringify(
            value,
            null,
            2
          );
      }
    }

    return editInteractionV2(
      interaction,
      {
        title,
        description:
          truncateText(description, 3200)
      }
    );
  } catch (error) {
    return editInteractionV2(
      interaction,
      {
        title:
          "VEYX / REQUEST FAILED",

        description:
          error.message
      }
    );
  }
}

// ============================================================
// 59. HELP REFRESH BUTTON
// ============================================================

async function handleHelpRefreshButton(
  interaction
) {
  const settings =
    getGuildSettings(
      interaction.guild.id
    );

  const member =
    interaction.member;

  const unique =
    new Map();

  for (const command of veyxCommands.values()) {
    unique.set(
      command.name,
      command
    );
  }

  const available =
    [...unique.values()]
      .filter(command =>
        hasVeyxPermission(
          member,
          settings,
          command.permission
        )
      );

  const description =
    available
      .map(command =>
        `\`${settings.prefix}${command.name}\` — ` +
        escapeDiscordText(command.description)
      )
      .join("\n");

  return replyInteractionV2(
    interaction,
    {
      title:
        "VEYX / AVAILABLE COMMANDS",

      description:
        truncateText(description, 3400)
    },
    true
  );
}

// ============================================================
// 60. MAIN COMPONENT INTERACTION ROUTER
//
// Session vote buttons will be handled
// in Part 3.
//
// This listener routes only the buttons
// implemented in Part 2.
// ============================================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isButton() ||
      !interaction.guild
    ) {
      return;
    }

    const customId =
      interaction.customId;

    try {
      if (
        customId.startsWith(
          "veyx:erlc:"
        )
      ) {
        return await handleErlcPanelButton(
          interaction
        );
      }

      if (
        customId ===
        "veyx:help:refresh"
      ) {
        return await handleHelpRefreshButton(
          interaction
        );
      }

      // Part 3 will handle:
      //
      // veyx:vote:yes:<voteId>
      // veyx:vote:no:<voteId>
      // veyx:vote:results:<voteId>
      //
      // veyx:session:join
      //
    } catch (error) {
      console.error(
        "[VEYX INTERACTION]",
        error
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await editInteractionV2(
          interaction,
          {
            title:
              "VEYX / ERROR",

            description:
              error.message
          }
        ).catch(() => {});
      } else {
        await replyInteractionV2(
          interaction,
          {
            title:
              "VEYX / ERROR",

            description:
              error.message
          },
          true
        ).catch(() => {});
      }
    }
  }
);

// ============================================================
// VEYX v6.0
// PART 3 OF 5
//
// SESSION MANAGEMENT
// SESSION VOTING
// COMPONENTS V2 BUTTONS
// AUTOMATIC SESSION HANDLING
//
// Paste directly underneath Part 2.
// ============================================================

// ============================================================
// 61. SESSION MESSAGE FORMATTING
// ============================================================

function sessionTemplate(guildId, text, extra = {}) {
  const settings = getGuildSettings(guildId);
  const sessions = settings.sessions;

  const replacements = {
    "{server}": client.guilds.cache.get(guildId)?.name || "Unknown Server",
    "{prefix}": settings.prefix,
    "{required}": String(sessions.requiredVotes),
    "{duration}": String(sessions.voteDuration),
    "{yes}": String(extra.yes ?? 0),
    "{no}": String(extra.no ?? 0),
    "{total}": String(extra.total ?? 0),
    "{status}": String(extra.status ?? "Unknown"),
    "{joincode}": String(extra.joinCode ?? "Not configured")
  };

  let result = String(text ?? "");

  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }

  return escapeDiscordText(result);
}

function sessionMessage(
  guildId,
  titleKey,
  descriptionKey,
  extra = {}
) {
  const messages = getSessionMessages(guildId);

  return {
    title: sessionTemplate(
      guildId,
      messages[titleKey],
      extra
    ),

    description: sessionTemplate(
      guildId,
      messages[descriptionKey],
      extra
    )
  };
}

// ============================================================
// 62. SESSION JOIN LINK
//
// ER:LC does not guarantee a direct
// browser join URL through the API.
//
// Therefore this helper returns null
// unless a safe Roblox URL has been
// explicitly configured later.
// ============================================================

function getSessionJoinUrl(guildId) {
  const sessions = getSessionSettings(guildId);

  const url = sessions.joinUrl;

  if (
    typeof url !== "string" ||
    !url.startsWith("https://")
  ) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.hostname === "www.roblox.com" ||
      parsed.hostname === "roblox.com"
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

// ============================================================
// 63. SESSION ANNOUNCEMENT BUILDER
// ============================================================

function buildSessionAnnouncement(
  guildId,
  type,
  extra = {}
) {
  const config = {
    startup: [
      "startupTitle",
      "startupDescription"
    ],

    shutdown: [
      "shutdownTitle",
      "shutdownDescription"
    ],

    boost: [
      "boostTitle",
      "boostDescription"
    ],

    approved: [
      "approvedTitle",
      "approvedDescription"
    ],

    failed: [
      "failedTitle",
      "failedDescription"
    ]
  };

  const keys = config[type];

  if (!keys) {
    throw new Error(
      "Invalid session announcement type."
    );
  }

  const content = sessionMessage(
    guildId,
    keys[0],
    keys[1],
    extra
  );

  const rows = [];

  const buttons = getSessionButtons(guildId);

  const joinUrl = getSessionJoinUrl(guildId);

  if (
    type === "startup" &&
    buttons.showJoinButton &&
    joinUrl
  ) {
    rows.push(
      veyxButtonRow([
        veyxLinkButton(
          buttons.joinLabel || "Join Server",
          joinUrl
        )
      ])
    );
  }

  return {
    ...content,
    rows,
    footer: "VEYX / SESSION MANAGEMENT"
  };
}

// ============================================================
// 64. SESSION STATE VALIDATION
// ============================================================

function ensureSessionsEnabled(guildId) {
  const sessions = getSessionSettings(guildId);

  if (!sessions.enabled) {
    throw new Error(
      "Session management is disabled in the dashboard."
    );
  }

  return sessions;
}

function getSessionAnnouncementChannel(guild) {
  const channel = getSessionChannel(
    guild,
    "announcements"
  );

  if (!channel) {
    throw new Error(
      "Configure a session announcement channel in the dashboard."
    );
  }

  return channel;
}

function getSessionVoteChannel(guild) {
  const channel = getSessionChannel(
    guild,
    "votes"
  );

  if (!channel) {
    throw new Error(
      "Configure a session voting channel in the dashboard."
    );
  }

  return channel;
}

// ============================================================
// 65. START SESSION
// ============================================================

async function startVeyxSession(
  guild,
  startedBy = null,
  source = "manual"
) {
  const sessions = ensureSessionsEnabled(
    guild.id
  );

  if (sessions.active) {
    throw new Error(
      "A roleplay session is already active."
    );
  }

  const channel = getSessionAnnouncementChannel(
    guild
  );

  const announcement = buildSessionAnnouncement(
    guild.id,
    "startup"
  );

  const message = await sendVeyxMessage(
    channel,
    announcement
  );

  sessions.active = true;
  sessions.startedAt = Date.now();
  sessions.startedBy = startedBy;

  sessions.history.unshift({
    id: crypto.randomUUID(),
    type: "startup",
    source,
    userId: startedBy,
    timestamp: Date.now(),
    messageId: message.id
  });

  if (sessions.history.length > 200) {
    sessions.history.length = 200;
  }

  const settings = getGuildSettings(guild.id);

  settings.statistics.sessionsStarted++;

  addAuditEvent(
    guild.id,
    "SESSION_START",
    `Session started via ${source}.`,
    startedBy
  );

  saveDatabase();

  return message;
}

// ============================================================
// 66. END SESSION
// ============================================================

async function endVeyxSession(
  guild,
  endedBy = null,
  source = "manual"
) {
  const sessions = ensureSessionsEnabled(
    guild.id
  );

  if (!sessions.active) {
    throw new Error(
      "No roleplay session is currently active."
    );
  }

  const channel = getSessionAnnouncementChannel(
    guild
  );

  const announcement = buildSessionAnnouncement(
    guild.id,
    "shutdown"
  );

  const message = await sendVeyxMessage(
    channel,
    announcement
  );

  sessions.active = false;

  sessions.history.unshift({
    id: crypto.randomUUID(),
    type: "shutdown",
    source,
    userId: endedBy,
    timestamp: Date.now(),
    messageId: message.id
  });

  sessions.startedAt = null;
  sessions.startedBy = null;

  if (sessions.history.length > 200) {
    sessions.history.length = 200;
  }

  const settings = getGuildSettings(guild.id);

  settings.statistics.sessionsEnded++;

  addAuditEvent(
    guild.id,
    "SESSION_END",
    `Session ended via ${source}.`,
    endedBy
  );

  saveDatabase();

  return message;
}

// ============================================================
// 67. BOOST SESSION
// ============================================================

async function boostVeyxSession(
  guild,
  boostedBy = null
) {
  const sessions = ensureSessionsEnabled(
    guild.id
  );

  if (!sessions.active) {
    throw new Error(
      "You must start a session before boosting it."
    );
  }

  const channel = getSessionAnnouncementChannel(
    guild
  );

  const announcement = buildSessionAnnouncement(
    guild.id,
    "boost"
  );

  const message = await sendVeyxMessage(
    channel,
    announcement
  );

  sessions.history.unshift({
    id: crypto.randomUUID(),
    type: "boost",
    userId: boostedBy,
    timestamp: Date.now(),
    messageId: message.id
  });

  if (sessions.history.length > 200) {
    sessions.history.length = 200;
  }

  addAuditEvent(
    guild.id,
    "SESSION_BOOST",
    "A session boost was posted.",
    boostedBy
  );

  saveDatabase();

  return message;
}

// ============================================================
// 68. VOTE COMPONENTS
// ============================================================

function buildVoteComponents(guildId, vote) {
  const settings = getSessionSettings(guildId);
  const buttons = getSessionButtons(guildId);

  const counts = countVotes(vote);

  const required =
    Number(vote.requiredVotes || settings.requiredVotes);

  const open = vote.status === "open";

  const expiresAt = vote.expiresAt
    ? `<t:${Math.floor(vote.expiresAt / 1000)}:R>`
    : "Unknown";

  const description = [
    sessionTemplate(
      guildId,
      getSessionMessages(guildId).voteDescription,
      {
        yes: counts.yes,
        no: counts.no,
        total: counts.total,
        status: vote.status
      }
    ),
    "",
    "### VOTE RESULTS",
    `**Yes Votes:** ${counts.yes} / ${required}`,
    `**No Votes:** ${counts.no}`,
    `**Total Votes:** ${counts.total}`,
    "",
    `**Status:** ${vote.status.toUpperCase()}`,
    `**Expires:** ${expiresAt}`
  ].join("\n");

  const actionButtons = [
    veyxButton(
      `veyx:vote:yes:${vote.id}`,
      buttons.yesLabel || "Vote Yes",
      ButtonStyle.Success,
      !open
    )
  ];

  if (settings.allowNoVotes) {
    actionButtons.push(
      veyxButton(
        `veyx:vote:no:${vote.id}`,
        buttons.noLabel || "Vote No",
        ButtonStyle.Danger,
        !open
      )
    );
  }

  if (buttons.showResultsButton) {
    actionButtons.push(
      veyxButton(
        `veyx:vote:results:${vote.id}`,
        buttons.resultsLabel || "View Results",
        ButtonStyle.Secondary
      )
    );
  }

  return {
    title: sessionTemplate(
      guildId,
      getSessionMessages(guildId).voteTitle
    ),

    description,

    rows: [
      veyxButtonRow(actionButtons)
    ],

    footer: "VEYX / SESSION VOTING"
  };
}

// ============================================================
// 69. CREATE SESSION VOTE
// ============================================================

async function createVeyxVote(
  guild,
  createdBy = null,
  options = {}
) {
  const sessions = ensureSessionsEnabled(
    guild.id
  );

  if (
    sessions.oneVoteAtATime &&
    getActiveVote(guild.id)
  ) {
    throw new Error(
      "A session vote is already active."
    );
  }

  const channel = getSessionVoteChannel(
    guild
  );

  const requiredVotes = Math.max(
    1,
    Math.min(
      10000,
      Number(
        options.requiredVotes ||
        sessions.requiredVotes
      )
    )
  );

  const durationMinutes = Math.max(
    1,
    Math.min(
      1440,
      Number(
        options.duration ||
        sessions.voteDuration
      )
    )
  );

  const vote = {
    id: createVoteId(),

    guildId: guild.id,

    createdBy,

    createdAt: Date.now(),

    expiresAt:
      Date.now() + durationMinutes * 60000,

    requiredVotes,

    status: "open",

    voters: {},

    channelId: channel.id,

    messageId: null,

    approvedAt: null,

    closedAt: null
  };

  sessions.votes[vote.id] = vote;

  const message = await sendVeyxMessage(
    channel,
    buildVoteComponents(
      guild.id,
      vote
    )
  );

  vote.messageId = message.id;

  sessions.activeVoteId = vote.id;

  const settings = getGuildSettings(guild.id);

  settings.statistics.votesCreated++;

  addAuditEvent(
    guild.id,
    "SESSION_VOTE_CREATED",
    `Vote created. Required votes: ${requiredVotes}.`,
    createdBy
  );

  saveDatabase();

  return vote;
}

// ============================================================
// 70. UPDATE VOTE MESSAGE
// ============================================================

async function updateVeyxVoteMessage(
  guildId,
  vote
) {
  if (!vote.channelId || !vote.messageId) {
    return false;
  }

  const guild = client.guilds.cache.get(
    guildId
  );

  if (!guild) {
    return false;
  }

  const channel =
    await guild.channels.fetch(
      vote.channelId
    ).catch(() => null);

  if (
    !channel ||
    !channel.messages
  ) {
    return false;
  }

  const message =
    await channel.messages.fetch(
      vote.messageId
    ).catch(() => null);

  if (!message) {
    return false;
  }

  await editVeyxMessage(
    message,
    buildVoteComponents(
      guildId,
      vote
    )
  );

  return true;
}

// ============================================================
// 71. APPROVE SESSION VOTE
// ============================================================

async function approveVeyxVote(
  guild,
  vote
) {
  if (vote.status !== "open") {
    return;
  }

  const sessions = getSessionSettings(
    guild.id
  );

  vote.status = "approved";
  vote.approvedAt = Date.now();
  vote.closedAt = Date.now();

  if (
    sessions.activeVoteId === vote.id
  ) {
    sessions.activeVoteId = null;
  }

  const settings = getGuildSettings(
    guild.id
  );

  settings.statistics.votesApproved++;

  saveDatabase();

  await updateVeyxVoteMessage(
    guild.id,
    vote
  ).catch(console.error);

  const channel =
    getSessionVoteChannel(guild);

  if (channel) {
    await sendVeyxMessage(
      channel,
      buildSessionAnnouncement(
        guild.id,
        "approved",
        countVotes(vote)
      )
    ).catch(console.error);
  }

  addAuditEvent(
    guild.id,
    "SESSION_VOTE_APPROVED",
    `Vote ${vote.id} reached its target.`,
    vote.createdBy
  );

  if (
    sessions.autoStart &&
    !sessions.active
  ) {
    await startVeyxSession(
      guild,
      vote.createdBy,
      "automatic_vote"
    ).catch(error => {
      console.error(
        "[VEYX AUTO SESSION]",
        error
      );
    });
  }
}

// ============================================================
// 72. CLOSE SESSION VOTE
// ============================================================

async function closeVeyxVote(
  guild,
  vote,
  reason = "expired"
) {
  if (vote.status !== "open") {
    return;
  }

  const sessions = getSessionSettings(
    guild.id
  );

  vote.status =
    reason === "expired"
      ? "expired"
      : "closed";

  vote.closedAt = Date.now();

  if (
    sessions.activeVoteId === vote.id
  ) {
    sessions.activeVoteId = null;
  }

  const settings = getGuildSettings(
    guild.id
  );

  settings.statistics.votesFailed++;

  saveDatabase();

  await updateVeyxVoteMessage(
    guild.id,
    vote
  ).catch(console.error);

  const channel =
    getSessionVoteChannel(guild);

  if (channel) {
    await sendVeyxMessage(
      channel,
      buildSessionAnnouncement(
        guild.id,
        "failed",
        countVotes(vote)
      )
    ).catch(console.error);
  }

  addAuditEvent(
    guild.id,
    "SESSION_VOTE_CLOSED",
    `Vote ${vote.id} closed: ${reason}.`,
    vote.createdBy
  );
}

// ============================================================
// 73. REGISTER A VOTE
// ============================================================

async function registerVeyxVote(
  interaction,
  voteId,
  choice
) {
  const guildId = interaction.guild.id;

  const sessions = getSessionSettings(
    guildId
  );

  const vote = sessions.votes[voteId];

  if (!vote) {
    throw new Error(
      "This vote no longer exists."
    );
  }

  if (vote.status !== "open") {
    throw new Error(
      "This vote is already closed."
    );
  }

  if (Date.now() >= vote.expiresAt) {
    await closeVeyxVote(
      interaction.guild,
      vote,
      "expired"
    );

    throw new Error(
      "This vote has expired."
    );
  }

  if (
    choice !== "yes" &&
    choice !== "no"
  ) {
    throw new Error(
      "Invalid vote choice."
    );
  }

  if (
    choice === "no" &&
    !sessions.allowNoVotes
  ) {
    throw new Error(
      "No votes are disabled for this server."
    );
  }

  const userId = interaction.user.id;

  const previousVote =
    vote.voters[userId];

  if (
    previousVote &&
    previousVote !== choice &&
    !sessions.allowVoteChanges
  ) {
    throw new Error(
      "Vote changes are disabled."
    );
  }

  if (previousVote === choice) {
    return {
      changed: false,
      choice,
      counts: countVotes(vote)
    };
  }

  vote.voters[userId] = choice;

  saveDatabase();

  const counts = countVotes(vote);

  if (
    sessions.closeOnSuccess &&
    counts.yes >= vote.requiredVotes
  ) {
    await approveVeyxVote(
      interaction.guild,
      vote
    );
  } else {
    await updateVeyxVoteMessage(
      guildId,
      vote
    ).catch(console.error);
  }

  return {
    changed: true,
    choice,
    counts
  };
}

// ============================================================
// 74. SESSION VOTE BUTTON HANDLER
// ============================================================

async function handleVeyxVoteButton(
  interaction
) {
  const parts =
    interaction.customId.split(":");

  const action = parts[2];
  const voteId = parts[3];

  const sessions = getSessionSettings(
    interaction.guild.id
  );

  const vote = sessions.votes[voteId];

  if (!vote) {
    return replyInteractionV2(
      interaction,
      {
        title: "VEYX / VOTE NOT FOUND",
        description:
          "This session vote no longer exists."
      },
      true
    );
  }

  if (action === "results") {
    const counts = countVotes(vote);

    return replyInteractionV2(
      interaction,
      {
        title: "VEYX / VOTE RESULTS",

        description: [
          `**Yes Votes:** ${counts.yes} / ${vote.requiredVotes}`,
          `**No Votes:** ${counts.no}`,
          `**Total Votes:** ${counts.total}`,
          `**Status:** ${vote.status.toUpperCase()}`
        ].join("\n")
      },
      true
    );
  }

  if (
    action !== "yes" &&
    action !== "no"
  ) {
    throw new Error(
      "Unknown vote action."
    );
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    const result = await registerVeyxVote(
      interaction,
      voteId,
      action
    );

    return editInteractionV2(
      interaction,
      {
        title:
          result.changed
            ? "VEYX / VOTE RECORDED"
            : "VEYX / ALREADY VOTED",

        description: [
          `**Your Vote:** ${action.toUpperCase()}`,
          "",
          `**Yes:** ${result.counts.yes} / ${vote.requiredVotes}`,
          `**No:** ${result.counts.no}`,
          `**Total:** ${result.counts.total}`,
          "",
          result.changed
            ? "Your vote has been saved."
            : "You have already selected this option."
        ].join("\n")
      }
    );
  } catch (error) {
    return editInteractionV2(
      interaction,
      {
        title: "VEYX / VOTE FAILED",
        description: error.message
      }
    );
  }
}

// ============================================================
// 75. SESSION VOTE EXPIRATION
// ============================================================

let voteExpirationRunning = false;

async function checkExpiredVeyxVotes() {
  if (voteExpirationRunning) {
    return;
  }

  voteExpirationRunning = true;

  try {
    for (
      const [guildId, settings]
      of Object.entries(database.guilds)
    ) {
      const guild =
        client.guilds.cache.get(guildId);

      if (!guild) {
        continue;
      }

      const votes =
        settings.sessions?.votes || {};

      for (const vote of Object.values(votes)) {
        if (
          vote.status === "open" &&
          Date.now() >= vote.expiresAt
        ) {
          await closeVeyxVote(
            guild,
            vote,
            "expired"
          );
        }
      }
    }
  } finally {
    voteExpirationRunning = false;
  }
}

// Start checking when the bot is ready.

client.once(
  Events.ClientReady,
  () => {
    setInterval(
      () => {
        checkExpiredVeyxVotes()
          .catch(console.error);
      },
      15000
    );

    checkExpiredVeyxVotes()
      .catch(console.error);
  }
);

// ============================================================
// 76. SESSION STARTUP COMMAND
// ============================================================

registerVeyxCommand({
  name: "ssu",

  aliases: ["sessionstart"],

  description: "Start an ER:LC roleplay session.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  async execute(ctx) {
    await startVeyxSession(
      ctx.guild,
      ctx.user.id,
      "discord_command"
    );

    return commandSuccess(
      ctx,
      "SESSION STARTED",
      "The session startup announcement has been posted."
    );
  }
});

// ============================================================
// 77. SESSION SHUTDOWN COMMAND
// ============================================================

registerVeyxCommand({
  name: "ssd",

  aliases: ["sessionend"],

  description: "End the active ER:LC session.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  async execute(ctx) {
    await endVeyxSession(
      ctx.guild,
      ctx.user.id,
      "discord_command"
    );

    return commandSuccess(
      ctx,
      "SESSION ENDED",
      "The session shutdown announcement has been posted."
    );
  }
});

// ============================================================
// 78. SESSION BOOST COMMAND
// ============================================================

registerVeyxCommand({
  name: "boost",

  aliases: ["sessionboost"],

  description: "Boost the active roleplay session.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    await boostVeyxSession(
      ctx.guild,
      ctx.user.id
    );

    return commandSuccess(
      ctx,
      "SESSION BOOSTED",
      "The session boost announcement has been posted."
    );
  }
});

// ============================================================
// 79. SESSION VOTE COMMAND
// ============================================================

registerVeyxCommand({
  name: "svote",

  aliases: ["sessionvote"],

  description: "Create a session vote with buttons.",

  permission:
    PERMISSION_LEVELS.SENIOR_STAFF,

  async execute(ctx) {
    const vote = await createVeyxVote(
      ctx.guild,
      ctx.user.id
    );

    return commandSuccess(
      ctx,
      "SESSION VOTE CREATED",
      [
        `**Vote ID:** \`${vote.id}\``,
        `**Required Yes Votes:** ${vote.requiredVotes}`,
        `**Duration:** ${Math.round((vote.expiresAt - vote.createdAt) / 60000)} minutes`,
        "",
        "Members can now vote using the buttons."
      ].join("\n")
    );
  }
});

// ============================================================
// 80. SESSION MANAGEMENT COMMAND
// ============================================================

registerVeyxCommand({
  name: "session",

  description: "View and manage session status.",

  permission:
    PERMISSION_LEVELS.STAFF,

  async execute(ctx) {
    const action =
      (ctx.args[0] || "status").toLowerCase();

    const sessions =
      getSessionSettings(ctx.guild.id);

    if (action === "status") {
      const vote =
        getActiveVote(ctx.guild.id);

      const sections = [
        [
          "**SESSION STATUS**",
          `Active: ${sessions.active ? "YES" : "NO"}`,
          `Started: ${sessions.startedAt ? formatTimestamp(sessions.startedAt) : "Not active"}`
        ].join("\n"),

        [
          "**VOTE CONFIGURATION**",
          `Required Yes Votes: ${sessions.requiredVotes}`,
          `Vote Duration: ${sessions.voteDuration} minutes`,
          `Automatic Startup: ${sessions.autoStart ? "ENABLED" : "DISABLED"}`
        ].join("\n"),

        [
          "**ACTIVE VOTE**",
          vote
            ? `Vote ID: ${vote.id}\nYes: ${countVotes(vote).yes} / ${vote.requiredVotes}`
            : "No active vote."
        ].join("\n")
      ];

      return ctx.reply({
        title: "VEYX / SESSION CONTROL",
        description:
          "Manage your server's roleplay sessions.",
        sections,

        rows: [
          veyxButtonRow([
            veyxButton(
              "veyx:session:status",
              "Refresh Status"
            ),

            veyxLinkButton(
              "Dashboard",
              `${BASE_URL}/dashboard`
            )
          ])
        ]
      });
    }

    if (action === "history") {
      return commandReply(
        ctx,
        "VEYX / SESSION HISTORY",
        formatList(
          sessions.history,
          record =>
            `**${record.type.toUpperCase()}** — ` +
            formatTimestamp(record.timestamp)
        )
      );
    }

    if (action === "closevote") {
      if (
        !hasVeyxPermission(
          ctx.member,
          ctx.settings,
          PERMISSION_LEVELS.SENIOR_STAFF
        )
      ) {
        throw new Error(
          "Senior Staff permission required."
        );
      }

      const vote =
        getActiveVote(ctx.guild.id);

      if (!vote) {
        throw new Error(
          "There is no active session vote."
        );
      }

      await closeVeyxVote(
        ctx.guild,
        vote,
        "manual"
      );

      return commandSuccess(
        ctx,
        "VOTE CLOSED",
        "The active session vote has been closed."
      );
    }

    throw new Error(
      "Usage: session status | history | closevote"
    );
  }
});

// ============================================================
// 81. SESSION STATUS BUTTON
// ============================================================

async function handleVeyxSessionButton(
  interaction
) {
  const action =
    interaction.customId.split(":")[2];

  if (action === "status") {
    const sessions =
      getSessionSettings(
        interaction.guild.id
      );

    const vote =
      getActiveVote(
        interaction.guild.id
      );

    return updateInteractionV2(
      interaction,
      {
        title: "VEYX / SESSION CONTROL",

        description: [
          `**Session Active:** ${sessions.active ? "YES" : "NO"}`,
          `**Required Votes:** ${sessions.requiredVotes}`,
          `**Vote Duration:** ${sessions.voteDuration} minutes`,
          `**Active Vote:** ${vote ? vote.id : "None"}`,
          "",
          "Session status refreshed."
        ].join("\n"),

        rows: [
          veyxButtonRow([
            veyxButton(
              "veyx:session:status",
              "Refresh Status"
            ),

            veyxLinkButton(
              "Dashboard",
              `${BASE_URL}/dashboard`
            )
          ])
        ]
      }
    );
  }
}

// ============================================================
// 82. SESSION INTERACTION ROUTER
// ============================================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isButton() ||
      !interaction.guild
    ) {
      return;
    }

    try {
      if (
        interaction.customId.startsWith(
          "veyx:vote:"
        )
      ) {
        return await handleVeyxVoteButton(
          interaction
        );
      }

      if (
        interaction.customId.startsWith(
          "veyx:session:"
        )
      ) {
        return await handleVeyxSessionButton(
          interaction
        );
      }
    } catch (error) {
      console.error(
        "[VEYX SESSION BUTTON]",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await replyInteractionV2(
          interaction,
          {
            title: "VEYX / ERROR",
            description: error.message
          },
          true
        ).catch(() => {});
      }
    }
  }
);
// ============================================================
// VEYX v6.0
// PART 4 OF 5
//
// DASHBOARD BACKEND
// DISCORD OAUTH2
// SERVER CONFIGURATION
// SESSION MANAGEMENT API
//
// Paste directly underneath Part 3.
// ============================================================

// ============================================================
// 83. WEB SESSION CONFIGURATION
// ============================================================

app.use(
  session({
    name: "veyx.sid",

    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,

      secure: IS_PRODUCTION,

      sameSite: "lax",

      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// ============================================================
// 84. DISCORD OAUTH2 CONFIGURATION
// ============================================================

const DISCORD_API = "https://discord.com/api/v10";

const DISCORD_OAUTH_URL =
  "https://discord.com/oauth2/authorize";

const DISCORD_CLIENT_ID =
  process.env.CLIENT_ID;

const DISCORD_CLIENT_SECRET =
  process.env.CLIENT_SECRET;

const OAUTH_SCOPES = [
  "identify",
  "guilds"
];

function buildDiscordLoginUrl(state) {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,

    redirect_uri: REDIRECT_URI,

    response_type: "code",

    scope: OAUTH_SCOPES.join(" "),

    state,

    prompt: "none"
  });

  return `${DISCORD_OAUTH_URL}?${params}`;
}

// ============================================================
// 85. DISCORD API REQUESTS
// ============================================================

async function discordApiRequest(
  endpoint,
  accessToken
) {
  const response = await fetch(
    `${DISCORD_API}${endpoint}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Discord API returned HTTP ${response.status}.`
    );
  }

  return response.json();
}

async function exchangeDiscordOAuthCode(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,

    client_secret: DISCORD_CLIENT_SECRET,

    grant_type: "authorization_code",

    code,

    redirect_uri: REDIRECT_URI
  });

  const response = await fetch(
    `${DISCORD_API}/oauth2/token`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body
    }
  );

  if (!response.ok) {
    throw new Error(
      "Discord OAuth2 token exchange failed."
    );
  }

  return response.json();
}

async function refreshDiscordOAuthToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,

    client_secret: DISCORD_CLIENT_SECRET,

    grant_type: "refresh_token",

    refresh_token: refreshToken
  });

  const response = await fetch(
    `${DISCORD_API}/oauth2/token`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body
    }
  );

  if (!response.ok) {
    throw new Error(
      "Discord OAuth2 token refresh failed."
    );
  }

  return response.json();
}

// ============================================================
// 86. OAUTH2 TOKEN MANAGEMENT
// ============================================================

async function getValidAccessToken(req) {
  const auth = req.session.discord;

  if (!auth) {
    throw new Error(
      "Not authenticated."
    );
  }

  if (
    Date.now() <
    auth.expiresAt - 60000
  ) {
    return auth.accessToken;
  }

  const refreshed =
    await refreshDiscordOAuthToken(
      auth.refreshToken
    );

  req.session.discord = {
    ...auth,

    accessToken:
      refreshed.access_token,

    refreshToken:
      refreshed.refresh_token ||
      auth.refreshToken,

    expiresAt:
      Date.now() +
      refreshed.expires_in * 1000
  };

  return req.session.discord.accessToken;
}

// ============================================================
// 87. DISCORD GUILD PERMISSIONS
// ============================================================

function canManageDiscordGuild(guild) {
  if (guild.owner) {
    return true;
  }

  const permissions = BigInt(
    guild.permissions || "0"
  );

  return (
    (
      permissions &
      PermissionsBitField.Flags.Administrator
    ) !== 0n ||
    (
      permissions &
      PermissionsBitField.Flags.ManageGuild
    ) !== 0n
  );
}

async function getManageableDiscordGuilds(req) {
  const token =
    await getValidAccessToken(req);

  const guilds =
    await discordApiRequest(
      "/users/@me/guilds",
      token
    );

  return guilds
    .filter(canManageDiscordGuild)
    .map(guild => ({
      id: guild.id,

      name: guild.name,

      icon: guild.icon,

      owner: guild.owner,

      botInstalled:
        client.guilds.cache.has(guild.id)
    }));
}

// ============================================================
// 88. DASHBOARD AUTHENTICATION
// ============================================================

function requireDashboardLogin(
  req,
  res,
  next
) {
  if (
    !req.session.discord ||
    !req.session.discord.user
  ) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  next();
}

async function requireGuildManager(
  req,
  res,
  next
) {
  try {
    const guildId =
      req.params.guildId;

    if (
      !/^\d{17,22}$/.test(guildId)
    ) {
      return res.status(400).json({
        error: "Invalid guild ID."
      });
    }

    const guilds =
      await getManageableDiscordGuilds(req);

    const manageable =
      guilds.find(
        guild => guild.id === guildId
      );

    if (!manageable) {
      return res.status(403).json({
        error:
          "You do not have permission to manage this server."
      });
    }

    const guild =
      client.guilds.cache.get(guildId);

    if (!guild) {
      return res.status(404).json({
        error:
          "Veyx is not installed in this Discord server."
      });
    }

    req.veyxGuild = guild;

    req.veyxSettings =
      getGuildSettings(guildId);

    next();
  } catch (error) {
    next(error);
  }
}

// ============================================================
// 89. DASHBOARD JSON RESPONSE HELPERS
// ============================================================

function apiSuccess(
  res,
  data = {}
) {
  return res.json({
    success: true,
    ...data
  });
}

function apiError(
  res,
  message,
  status = 400
) {
  return res.status(status).json({
    success: false,
    error: message
  });
}

function requireString(
  value,
  name,
  minimum = 1,
  maximum = 2000
) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(
      `${name} must contain ${minimum}-${maximum} characters.`
    );
  }

  return value;
}

function requireBoolean(
  value,
  name
) {
  if (typeof value !== "boolean") {
    throw new Error(
      `${name} must be true or false.`
    );
  }

  return value;
}

function requireInteger(
  value,
  name,
  minimum,
  maximum
) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}.`
    );
  }

  return value;
}

function requireOptionalDiscordId(
  value,
  name
) {
  if (
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{17,22}$/.test(value)
  ) {
    throw new Error(
      `Invalid ${name}.`
    );
  }

  return value;
}

// ============================================================
// 90. PUBLIC CONFIGURATION RESPONSE
//
// Never expose the decrypted API key.
// Never expose the encrypted API key.
// ============================================================

function getDashboardSettings(guildId) {
  const settings =
    getGuildSettings(guildId);

  return {
    prefix: settings.prefix,

    connected:
      !!settings.apiKeyEncrypted,

    roles: structuredClone(
      settings.roles
    ),

    channels: structuredClone(
      settings.channels
    ),

    logging: structuredClone(
      settings.logging
    ),

    sessions: {
      enabled:
        settings.sessions.enabled,

      requiredVotes:
        settings.sessions.requiredVotes,

      voteDuration:
        settings.sessions.voteDuration,

      autoStart:
        settings.sessions.autoStart,

      allowVoteChanges:
        settings.sessions.allowVoteChanges,

      allowNoVotes:
        settings.sessions.allowNoVotes,

      closeOnSuccess:
        settings.sessions.closeOnSuccess,

      oneVoteAtATime:
        settings.sessions.oneVoteAtATime,

      joinUrl:
        settings.sessions.joinUrl || "",

      messages: structuredClone(
        settings.sessions.messages
      ),

      buttons: structuredClone(
        settings.sessions.buttons
      ),

      active:
        settings.sessions.active,

      startedAt:
        settings.sessions.startedAt,

      activeVoteId:
        settings.sessions.activeVoteId
    },

    statistics: structuredClone(
      settings.statistics
    )
  };
}

// ============================================================
// 91. DISCORD LOGIN ROUTE
// ============================================================

app.get(
  "/auth/login",
  (req, res) => {
    const state =
      crypto.randomBytes(24)
        .toString("hex");

    req.session.oauthState = state;

    req.session.save(error => {
      if (error) {
        return res.status(500).send(
          "Could not start Discord login."
        );
      }

      return res.redirect(
        buildDiscordLoginUrl(state)
      );
    });
  }
);

// ============================================================
// 92. DISCORD OAUTH2 CALLBACK
// ============================================================

app.get(
  "/auth/callback",
  async (req, res) => {
    try {
      const code =
        req.query.code;

      const state =
        req.query.state;

      if (
        typeof code !== "string" ||
        typeof state !== "string" ||
        !req.session.oauthState ||
        state !== req.session.oauthState
      ) {
        return res.status(400).send(
          "Invalid Discord OAuth2 callback."
        );
      }

      delete req.session.oauthState;

      const tokens =
        await exchangeDiscordOAuthCode(
          code
        );

      const user =
        await discordApiRequest(
          "/users/@me",
          tokens.access_token
        );

      req.session.discord = {
        user: {
          id: user.id,

          username:
            user.username,

          globalName:
            user.global_name,

          avatar:
            user.avatar
        },

        accessToken:
          tokens.access_token,

        refreshToken:
          tokens.refresh_token,

        expiresAt:
          Date.now() +
          tokens.expires_in * 1000
      };

      req.session.save(error => {
        if (error) {
          return res.status(500).send(
            "Could not save your login."
          );
        }

        return res.redirect(
          "/dashboard"
        );
      });
    } catch (error) {
      console.error(
        "[VEYX OAUTH]",
        error
      );

      return res.status(500).send(
        "Discord authentication failed."
      );
    }
  }
);

// ============================================================
// 93. LOGOUT
// ============================================================

app.post(
  "/auth/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        return apiError(
          res,
          "Could not log out.",
          500
        );
      }

      res.clearCookie("veyx.sid");

      return apiSuccess(res);
    });
  }
);

// ============================================================
// 94. CURRENT USER
// ============================================================

app.get(
  "/api/me",
  requireDashboardLogin,
  (req, res) => {
    return apiSuccess(
      res,
      {
        user:
          req.session.discord.user
      }
    );
  }
);

// ============================================================
// 95. MANAGEABLE DISCORD SERVERS
// ============================================================

app.get(
  "/api/guilds",
  requireDashboardLogin,
  async (req, res, next) => {
    try {
      const guilds =
        await getManageableDiscordGuilds(
          req
        );

      return apiSuccess(
        res,
        {
          guilds
        }
      );
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================
// 96. SERVER DASHBOARD OVERVIEW
// ============================================================

app.get(
  "/api/guild/:guildId",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    const guild =
      req.veyxGuild;

    const settings =
      req.veyxSettings;

    return apiSuccess(
      res,
      {
        guild: {
          id: guild.id,

          name: guild.name,

          icon: guild.iconURL(),

          memberCount:
            guild.memberCount
        },

        settings:
          getDashboardSettings(
            guild.id
          ),

        recentEvents:
          settings.events.slice(0, 20)
      }
    );
  }
);

// ============================================================
// 97. DASHBOARD ROLES AND CHANNELS
// ============================================================

app.get(
  "/api/guild/:guildId/options",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    const guild =
      req.veyxGuild;

    const roles =
      guild.roles.cache
        .filter(role =>
          role.id !== guild.id
        )
        .map(role => ({
          id: role.id,
          name: role.name
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name)
        );

    const channels =
      guild.channels.cache
        .filter(channel =>
          typeof channel.send === "function"
        )
        .map(channel => ({
          id: channel.id,
          name: channel.name
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name)
        );

    return apiSuccess(
      res,
      {
        roles,
        channels
      }
    );
  }
);

// ============================================================
// 98. GENERAL SERVER SETTINGS
// ============================================================

app.patch(
  "/api/guild/:guildId/settings",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    try {
      const settings =
        req.veyxSettings;

      const body =
        req.body || {};

      if (
        body.prefix !== undefined
      ) {
        const prefix =
          requireString(
            body.prefix,
            "Prefix",
            1,
            5
          );

        if (
          /\s/.test(prefix) ||
          prefix.includes("@")
        ) {
          throw new Error(
            "Prefix cannot contain spaces or @."
          );
        }

        settings.prefix = prefix;
      }

      if (
        body.roles !== undefined
      ) {
        for (
          const key of Object.keys(
            settings.roles
          )
        ) {
          if (
            body.roles[key] !== undefined
          ) {
            const roleId =
              requireOptionalDiscordId(
                body.roles[key],
                key
              );

            if (
              roleId &&
              !req.veyxGuild.roles.cache.has(
                roleId
              )
            ) {
              throw new Error(
                `Role ${key} does not exist in this server.`
              );
            }

            settings.roles[key] =
              roleId;
          }
        }
      }

      if (
        body.channels !== undefined
      ) {
        for (
          const key of Object.keys(
            settings.channels
          )
        ) {
          if (
            body.channels[key] !== undefined
          ) {
            const channelId =
              requireOptionalDiscordId(
                body.channels[key],
                key
              );

            if (
              channelId &&
              !getTextChannel(
                req.veyxGuild,
                channelId
              )
            ) {
              throw new Error(
                `Channel ${key} is not a valid text channel.`
              );
            }

            settings.channels[key] =
              channelId;
          }
        }
      }

      if (
        body.logging !== undefined
      ) {
        for (
          const key of Object.keys(
            settings.logging
          )
        ) {
          if (
            body.logging[key] !== undefined
          ) {
            settings.logging[key] =
              requireBoolean(
                body.logging[key],
                key
              );
          }
        }
      }

      addAuditEvent(
        req.veyxGuild.id,
        "DASHBOARD_SETTINGS",
        "Server settings updated.",
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          settings:
            getDashboardSettings(
              req.veyxGuild.id
            )
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 99. CONNECT ER:LC API KEY
// ============================================================

app.post(
  "/api/guild/:guildId/connect",
  requireDashboardLogin,
  requireGuildManager,
  async (req, res) => {
    try {
      const apiKey =
        requireString(
          req.body?.apiKey,
          "ER:LC API key",
          10,
          300
        );

      const settings =
        req.veyxSettings;

      const previous =
        settings.apiKeyEncrypted;

      const encrypted =
        encryptSecret(apiKey);

      settings.apiKeyEncrypted =
        encrypted;

      try {
        await erlcRequest(
          req.veyxGuild.id,
          "/v2/server"
        );
      } catch (error) {
        settings.apiKeyEncrypted =
          previous;

        throw error;
      }

      clearGuildApiCache(
        req.veyxGuild.id
      );

      addAuditEvent(
        req.veyxGuild.id,
        "ERLC_CONNECTED",
        "ER:LC API key connected.",
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          connected: true
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 100. DISCONNECT ER:LC API KEY
// ============================================================

app.post(
  "/api/guild/:guildId/disconnect",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    req.veyxSettings.apiKeyEncrypted =
      null;

    clearGuildApiCache(
      req.veyxGuild.id
    );

    addAuditEvent(
      req.veyxGuild.id,
      "ERLC_DISCONNECTED",
      "ER:LC API key disconnected.",
      req.session.discord.user.id
    );

    saveDatabase();

    return apiSuccess(
      res,
      {
        connected: false
      }
    );
  }
);

// ============================================================
// 101. LIVE ER:LC SERVER DATA
// ============================================================

app.get(
  "/api/guild/:guildId/live",
  requireDashboardLogin,
  requireGuildManager,
  async (req, res) => {
    try {
      const data =
        await getErlcServer(
          req.veyxGuild.id,
          [
            "Players",
            "Staff",
            "Queue",
            "Vehicles"
          ]
        );

      return apiSuccess(
        res,
        {
          server: data
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message,
        502
      );
    }
  }
);

// ============================================================
// 102. DASHBOARD ER:LC REMOTE COMMAND
// ============================================================

app.post(
  "/api/guild/:guildId/command",
  requireDashboardLogin,
  requireGuildManager,
  async (req, res) => {
    try {
      const command =
        requireString(
          req.body?.command,
          "Command",
          2,
          180
        );

      if (
        !/^:[a-zA-Z][a-zA-Z0-9]*(?:\s|$)/.test(command) ||
        /[\r\n]/.test(command)
      ) {
        throw new Error(
          "Enter a valid ER:LC command beginning with a colon."
        );
      }

      const result =
        await sendErlcCommand(
          req.veyxGuild.id,
          command
        );

      req.veyxSettings.statistics.remoteCommands++;

      addAuditEvent(
        req.veyxGuild.id,
        "DASHBOARD_REMOTE_COMMAND",
        `Remote command executed: ${command}`,
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          result
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 103. UPDATE SESSION SETTINGS
// ============================================================

app.patch(
  "/api/guild/:guildId/sessions",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    try {
      const sessions =
        req.veyxSettings.sessions;

      const body =
        req.body || {};

      const booleans = [
        "enabled",
        "autoStart",
        "allowVoteChanges",
        "allowNoVotes",
        "closeOnSuccess",
        "oneVoteAtATime"
      ];

      for (const key of booleans) {
        if (
          body[key] !== undefined
        ) {
          sessions[key] =
            requireBoolean(
              body[key],
              key
            );
        }
      }

      if (
        body.requiredVotes !== undefined
      ) {
        sessions.requiredVotes =
          requireInteger(
            body.requiredVotes,
            "Required votes",
            1,
            10000
          );
      }

      if (
        body.voteDuration !== undefined
      ) {
        sessions.voteDuration =
          requireInteger(
            body.voteDuration,
            "Vote duration",
            1,
            1440
          );
      }

      if (
        body.joinUrl !== undefined
      ) {
        if (
          body.joinUrl === ""
        ) {
          sessions.joinUrl = "";
        } else {
          const url =
            requireString(
              body.joinUrl,
              "Join URL",
              8,
              300
            );

          const parsed =
            new URL(url);

          if (
            parsed.protocol !== "https:" ||
            ![
              "roblox.com",
              "www.roblox.com"
            ].includes(parsed.hostname)
          ) {
            throw new Error(
              "Join URL must be a Roblox HTTPS URL."
            );
          }

          sessions.joinUrl =
            parsed.toString();
        }
      }

      addAuditEvent(
        req.veyxGuild.id,
        "SESSION_SETTINGS",
        "Session configuration updated.",
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          sessions:
            getDashboardSettings(
              req.veyxGuild.id
            ).sessions
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 104. UPDATE SESSION MESSAGES
// ============================================================

app.patch(
  "/api/guild/:guildId/session-messages",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    try {
      const messages =
        req.veyxSettings.sessions.messages;

      const body =
        req.body || {};

      for (
        const key of Object.keys(messages)
      ) {
        if (
          body[key] !== undefined
        ) {
          messages[key] =
            requireString(
              body[key],
              key,
              1,
              1800
            );
        }
      }

      addAuditEvent(
        req.veyxGuild.id,
        "SESSION_MESSAGES",
        "Session messages updated.",
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          messages
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 105. UPDATE SESSION BUTTONS
// ============================================================

app.patch(
  "/api/guild/:guildId/session-buttons",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    try {
      const buttons =
        req.veyxSettings.sessions.buttons;

      const body =
        req.body || {};

      const labels = [
        "yesLabel",
        "noLabel",
        "resultsLabel",
        "joinLabel"
      ];

      for (const key of labels) {
        if (
          body[key] !== undefined
        ) {
          buttons[key] =
            requireString(
              body[key],
              key,
              1,
              80
            );
        }
      }

      const booleans = [
        "showResultsButton",
        "showJoinButton"
      ];

      for (const key of booleans) {
        if (
          body[key] !== undefined
        ) {
          buttons[key] =
            requireBoolean(
              body[key],
              key
            );
        }
      }

      addAuditEvent(
        req.veyxGuild.id,
        "SESSION_BUTTONS",
        "Session button configuration updated.",
        req.session.discord.user.id
      );

      saveDatabase();

      return apiSuccess(
        res,
        {
          buttons
        }
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 106. DASHBOARD SESSION STATUS
// ============================================================

app.get(
  "/api/guild/:guildId/session-status",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    const sessions =
      req.veyxSettings.sessions;

    const vote =
      getActiveVote(
        req.veyxGuild.id
      );

    return apiSuccess(
      res,
      {
        active:
          sessions.active,

        startedAt:
          sessions.startedAt,

        activeVote: vote
          ? {
              id: vote.id,

              status: vote.status,

              requiredVotes:
                vote.requiredVotes,

              expiresAt:
                vote.expiresAt,

              counts:
                countVotes(vote)
            }
          : null,

        history:
          sessions.history.slice(0, 30)
      }
    );
  }
);

// ============================================================
// 107. DASHBOARD SESSION ACTIONS
// ============================================================

app.post(
  "/api/guild/:guildId/session-action",
  requireDashboardLogin,
  requireGuildManager,
  async (req, res) => {
    try {
      const action =
        requireString(
          req.body?.action,
          "Action",
          2,
          30
        );

      const guild =
        req.veyxGuild;

      const userId =
        req.session.discord.user.id;

      if (action === "start") {
        await startVeyxSession(
          guild,
          userId,
          "dashboard"
        );

        return apiSuccess(
          res,
          {
            message:
              "Session started."
          }
        );
      }

      if (action === "end") {
        await endVeyxSession(
          guild,
          userId,
          "dashboard"
        );

        return apiSuccess(
          res,
          {
            message:
              "Session ended."
          }
        );
      }

      if (action === "boost") {
        await boostVeyxSession(
          guild,
          userId
        );

        return apiSuccess(
          res,
          {
            message:
              "Session boosted."
          }
        );
      }

      if (action === "vote") {
        const vote =
          await createVeyxVote(
            guild,
            userId
          );

        return apiSuccess(
          res,
          {
            message:
              "Session vote created.",

            voteId:
              vote.id
          }
        );
      }

      if (action === "closevote") {
        const vote =
          getActiveVote(
            guild.id
          );

        if (!vote) {
          throw new Error(
            "No active vote exists."
          );
        }

        await closeVeyxVote(
          guild,
          vote,
          "dashboard"
        );

        return apiSuccess(
          res,
          {
            message:
              "Session vote closed."
          }
        );
      }

      throw new Error(
        "Unknown session action."
      );
    } catch (error) {
      return apiError(
        res,
        error.message
      );
    }
  }
);

// ============================================================
// 108. DASHBOARD AUDIT LOGS
// ============================================================

app.get(
  "/api/guild/:guildId/events",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    return apiSuccess(
      res,
      {
        events:
          req.veyxSettings.events
            .slice(0, 100)
      }
    );
  }
);

// ============================================================
// 109. DASHBOARD STATISTICS
// ============================================================

app.get(
  "/api/guild/:guildId/statistics",
  requireDashboardLogin,
  requireGuildManager,
  (req, res) => {
    const settings =
      req.veyxSettings;

    return apiSuccess(
      res,
      {
        statistics:
          settings.statistics,

        activeShifts:
          Object.keys(
            settings.staff.activeShifts
          ).length,

        warnings:
          Object.values(
            settings.moderation.warnings
          ).reduce(
            (total, warnings) =>
              total + warnings.length,
            0
          ),

        openCases:
          settings.moderation.cases
            .filter(record =>
              record.status === "open"
            ).length
      }
    );
  }
);

// ============================================================
// 110. DASHBOARD API ERROR HANDLER
// ============================================================

app.use(
  "/api",
  (error, req, res, next) => {
    console.error(
      "[VEYX DASHBOARD API]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return apiError(
      res,
      "An unexpected dashboard error occurred.",
      500
    );
  }
);
// ============================================================
// VEYX v6.0
// PART 5 OF 5
//
// COMPLETE DASHBOARD
// HTML + CSS + JAVASCRIPT
// BOT STARTUP
// WEB SERVER STARTUP
//
// Paste directly underneath Part 4.
// ============================================================

// ============================================================
// 111. DASHBOARD HTML
// ============================================================

const VEYX_DASHBOARD_HTML = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#080808">

<title>Veyx — Management Dashboard</title>

<style>
:root {
  --bg: #080808;
  --surface: #101010;
  --surface-2: #151515;
  --surface-3: #1c1c1c;
  --border: #292929;
  --border-light: #393939;
  --text: #f5f5f5;
  --muted: #858585;
  --muted-light: #b5b5b5;
  --white: #ffffff;
  --black: #050505;
  --radius: 12px;
  --sidebar: 265px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Arial,
    sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  opacity: .45;
  cursor: not-allowed;
}

a {
  color: inherit;
  text-decoration: none;
}

::selection {
  background: white;
  color: black;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #0b0b0b;
}

::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 10px;
}

.hidden {
  display: none !important;
}

/* ============================================================
   APP LAYOUT
============================================================ */

.app {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--sidebar);
  background: #0d0d0d;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.sidebar-brand {
  height: 88px;
  padding: 25px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-name {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 5px;
}

.brand-version {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 1px;
}

.sidebar-scroll {
  overflow-y: auto;
  padding: 22px 12px;
  flex: 1;
}

.nav-label {
  color: #666;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin: 20px 12px 10px;
}

.nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  background: transparent;
  color: #969696;
  padding: 12px 14px;
  margin-bottom: 4px;
  text-align: left;
  border-radius: 9px;
  transition: .15s;
}

.nav-item:hover {
  background: #181818;
  color: white;
}

.nav-item.active {
  background: #202020;
  border-color: #353535;
  color: white;
}

.nav-number {
  width: 23px;
  color: #666;
  font-size: 11px;
  font-weight: 800;
}

.nav-item.active .nav-number {
  color: white;
}

.sidebar-footer {
  padding: 18px;
  border-top: 1px solid var(--border);
}

.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 37px;
  height: 37px;
  border-radius: 50%;
  background: #252525;
  display: grid;
  place-items: center;
  font-weight: 800;
}

.user-name {
  font-size: 13px;
  font-weight: 700;
}

.user-sub {
  color: var(--muted);
  font-size: 11px;
}

.main {
  margin-left: var(--sidebar);
  width: calc(100% - var(--sidebar));
  min-height: 100vh;
}

.topbar {
  height: 88px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 35px;
  background: rgba(8,8,8,.95);
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(12px);
}

.breadcrumb {
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 1px;
}

.breadcrumb strong {
  color: white;
  font-weight: 600;
}

.top-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.content {
  padding: 38px;
  max-width: 1550px;
  margin: 0 auto;
}

.page {
  display: none;
}

.page.active {
  display: block;
}

.page-header {
  margin-bottom: 30px;
}

.eyebrow {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.page-title {
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 850;
  letter-spacing: -1.5px;
  margin: 0;
}

.page-description {
  color: var(--muted);
  max-width: 750px;
  margin-top: 10px;
  font-size: 14px;
}

/* ============================================================
   BUTTONS
============================================================ */

.btn {
  background: #181818;
  color: white;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 11px 17px;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: .3px;
  transition: .15s;
}

.btn:hover {
  background: #272727;
  border-color: #555;
}

.btn-primary {
  background: white;
  color: black;
  border-color: white;
}

.btn-primary:hover {
  background: #ddd;
  border-color: #ddd;
}

.btn-danger {
  background: #202020;
  border-color: #555;
  color: white;
}

.btn-small {
  padding: 8px 12px;
  font-size: 11px;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* ============================================================
   CARDS
============================================================ */

.grid {
  display: grid;
  gap: 18px;
}

.grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 25px;
  min-width: 0;
}

.card + .card {
  margin-top: 0;
}

.card-title {
  font-size: 15px;
  font-weight: 800;
  margin: 0 0 8px;
}

.card-subtitle {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 22px;
}

.metric-label {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 1px;
  font-weight: 700;
  text-transform: uppercase;
}

.metric-value {
  font-size: 35px;
  font-weight: 850;
  letter-spacing: -1px;
  margin-top: 10px;
}

.metric-note {
  font-size: 11px;
  color: #777;
  margin-top: 8px;
}

.section-gap {
  margin-top: 22px;
}

/* ============================================================
   FORMS
============================================================ */

.field {
  margin-bottom: 19px;
}

.field:last-child {
  margin-bottom: 0;
}

.field label {
  display: block;
  color: #ddd;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}

.field-description {
  color: #777;
  font-size: 11px;
  margin-top: 6px;
}

.input,
.select,
.textarea {
  width: 100%;
  background: #090909;
  color: white;
  border: 1px solid #333;
  border-radius: 8px;
  outline: none;
  padding: 12px 13px;
  transition: .15s;
}

.input:focus,
.select:focus,
.textarea:focus {
  border-color: #aaa;
}

.textarea {
  min-height: 110px;
  resize: vertical;
  line-height: 1.6;
}

.select {
  appearance: auto;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid #252525;
  padding: 17px 0;
}

.toggle-row:last-child {
  border-bottom: 0;
}

.toggle-name {
  font-weight: 700;
  font-size: 13px;
}

.toggle-description {
  color: var(--muted);
  font-size: 11px;
  margin-top: 3px;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 25px;
  flex-shrink: 0;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: #303030;
  border: 1px solid #444;
  border-radius: 30px;
  transition: .2s;
}

.toggle-slider::before {
  content: "";
  position: absolute;
  height: 17px;
  width: 17px;
  left: 3px;
  top: 3px;
  background: #aaa;
  border-radius: 50%;
  transition: .2s;
}

.toggle input:checked + .toggle-slider {
  background: white;
  border-color: white;
}

.toggle input:checked + .toggle-slider::before {
  background: black;
  transform: translateX(19px);
}

/* ============================================================
   STATUS / DATA
============================================================ */

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 11px;
  background: #1b1b1b;
  border: 1px solid #353535;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .5px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ccc;
}

.status.offline .status-dot {
  background: #555;
}

.divider {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 24px 0;
}

.code {
  font-family: Consolas, Monaco, monospace;
  background: #191919;
  border: 1px solid #333;
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 12px;
}

.mono {
  font-family: Consolas, Monaco, monospace;
}

.pre {
  background: #070707;
  border: 1px solid #292929;
  border-radius: 9px;
  padding: 17px;
  color: #ddd;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 520px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.7;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.list-item {
  background: #141414;
  border: 1px solid #292929;
  border-radius: 8px;
  padding: 14px 16px;
}

.list-title {
  font-weight: 750;
  font-size: 12px;
}

.list-subtitle {
  font-size: 11px;
  color: #888;
  margin-top: 5px;
}

.empty {
  border: 1px dashed #333;
  padding: 28px;
  border-radius: 9px;
  color: #777;
  text-align: center;
}

/* ============================================================
   SERVER SELECTION
============================================================ */

.server-selector {
  background: #111;
  color: white;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 10px 13px;
  width: 230px;
  max-width: 100%;
}

.server-grid {
  display: grid;
  grid-template-columns:
    repeat(auto-fill, minmax(250px, 1fr));
  gap: 15px;
}

.server-card {
  text-align: left;
  background: #111;
  border: 1px solid #303030;
  border-radius: 12px;
  padding: 22px;
  transition: .2s;
  width: 100%;
  color: white;
}

.server-card:hover {
  border-color: white;
  transform: translateY(-2px);
}

.server-card-name {
  font-size: 17px;
  font-weight: 800;
  margin-bottom: 7px;
}

.server-card-meta {
  font-size: 12px;
  color: #888;
}

/* ============================================================
   TOAST
============================================================ */

.toast {
  position: fixed;
  right: 25px;
  bottom: 25px;
  max-width: 390px;
  background: #f5f5f5;
  color: black;
  padding: 15px 20px;
  border-radius: 9px;
  font-weight: 700;
  font-size: 12px;
  z-index: 200;
  box-shadow: 0 15px 60px #0009;
  opacity: 0;
  transform: translateY(15px);
  pointer-events: none;
  transition: .2s;
}

.toast.visible {
  opacity: 1;
  transform: translateY(0);
}

.toast.error {
  background: #262626;
  color: white;
  border: 1px solid #777;
}

/* ============================================================
   MOBILE
============================================================ */

.mobile-menu {
  display: none;
}

@media (max-width: 1150px) {
  .grid-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform .2s;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .main {
    margin-left: 0;
    width: 100%;
  }

  .mobile-menu {
    display: inline-flex;
  }

  .topbar {
    padding: 0 18px;
  }

  .content {
    padding: 25px 18px;
  }

  .grid-2,
  .grid-3 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 540px) {
  .grid-4 {
    grid-template-columns: 1fr;
  }

  .server-selector {
    width: 155px;
  }

  .topbar {
    gap: 10px;
  }

  .breadcrumb {
    display: none;
  }

  .card {
    padding: 19px;
  }

  .page-title {
    font-size: 29px;
  }
}
</style>
</head>

<body>

<div class="app">

  <!-- ======================================================
       SIDEBAR
  ======================================================= -->

  <aside class="sidebar" id="sidebar">

    <div class="sidebar-brand">
      <div>
        <div class="brand-name">VEYX</div>
        <div class="brand-version">MANAGEMENT SYSTEM / V6</div>
      </div>
    </div>

    <div class="sidebar-scroll">

      <div class="nav-label">Workspace</div>

      <button class="nav-item active" data-page="overview">
        <span class="nav-number">01</span>
        Overview
      </button>

      <button class="nav-item" data-page="servers">
        <span class="nav-number">02</span>
        Servers
      </button>

      <div class="nav-label">ER:LC</div>

      <button class="nav-item" data-page="connection">
        <span class="nav-number">03</span>
        Connection
      </button>

      <button class="nav-item" data-page="live">
        <span class="nav-number">04</span>
        Live Server
      </button>

      <button class="nav-item" data-page="console">
        <span class="nav-number">05</span>
        Command Console
      </button>

      <div class="nav-label">Sessions</div>

      <button class="nav-item" data-page="session-control">
        <span class="nav-number">06</span>
        Session Control
      </button>

      <button class="nav-item" data-page="session-settings">
        <span class="nav-number">07</span>
        Voting Settings
      </button>

      <button class="nav-item" data-page="session-messages">
        <span class="nav-number">08</span>
        Session Messages
      </button>

      <button class="nav-item" data-page="session-buttons">
        <span class="nav-number">09</span>
        Voting Buttons
      </button>

      <div class="nav-label">Configuration</div>

      <button class="nav-item" data-page="general">
        <span class="nav-number">10</span>
        General Settings
      </button>

      <button class="nav-item" data-page="permissions">
        <span class="nav-number">11</span>
        Permissions
      </button>

      <button class="nav-item" data-page="channels">
        <span class="nav-number">12</span>
        Channels
      </button>

      <button class="nav-item" data-page="logging">
        <span class="nav-number">13</span>
        Logging
      </button>

      <div class="nav-label">System</div>

      <button class="nav-item" data-page="statistics">
        <span class="nav-number">14</span>
        Statistics
      </button>

      <button class="nav-item" data-page="activity">
        <span class="nav-number">15</span>
        Activity Logs
      </button>

    </div>

    <div class="sidebar-footer">
      <div class="user-card">
        <div class="avatar" id="user-avatar">V</div>

        <div style="flex:1;min-width:0">
          <div class="user-name" id="user-name">Loading</div>
          <div class="user-sub">Authenticated via Discord</div>
        </div>

        <button
          class="btn btn-small"
          id="logout-button"
          type="button"
        >
          Exit
        </button>
      </div>
    </div>

  </aside>

  <!-- ======================================================
       MAIN
  ======================================================= -->

  <main class="main">

    <header class="topbar">

      <div class="top-actions">
        <button
          class="btn btn-small mobile-menu"
          id="mobile-menu-button"
          type="button"
        >
          Menu
        </button>

        <div class="breadcrumb">
          VEYX / <strong id="breadcrumb-page">OVERVIEW</strong>
        </div>
      </div>

      <div class="top-actions">
        <select
          id="server-selector"
          class="server-selector"
        >
          <option value="">Select a server</option>
        </select>

        <span class="status" id="connection-status">
          <span class="status-dot"></span>
          <span id="connection-label">NOT CONNECTED</span>
        </span>
      </div>

    </header>

    <div class="content">

      <!-- ==================================================
           OVERVIEW
      =================================================== -->

      <section class="page active" id="page-overview">

        <div class="page-header">
          <div class="eyebrow">Command Center</div>
          <h1 class="page-title">Overview</h1>
          <p class="page-description">
            Monitor your Discord server, ER:LC connection,
            moderation activity and roleplay sessions.
          </p>
        </div>

        <div class="grid grid-4">

          <div class="card">
            <div class="metric-label">Discord Members</div>
            <div class="metric-value" id="metric-members">—</div>
            <div class="metric-note">Current server members</div>
          </div>

          <div class="card">
            <div class="metric-label">Commands Executed</div>
            <div class="metric-value" id="metric-commands">—</div>
            <div class="metric-note">Recorded bot commands</div>
          </div>

          <div class="card">
            <div class="metric-label">Sessions Started</div>
            <div class="metric-value" id="metric-sessions">—</div>
            <div class="metric-note">Total roleplay sessions</div>
          </div>

          <div class="card">
            <div class="metric-label">Votes Created</div>
            <div class="metric-value" id="metric-votes">—</div>
            <div class="metric-note">Total session votes</div>
          </div>

        </div>

        <div class="grid grid-2 section-gap">

          <div class="card">
            <h2 class="card-title">Server Information</h2>
            <p class="card-subtitle">
              Current workspace configuration.
            </p>

            <div id="overview-server-info" class="list">
              <div class="empty">Select a server to begin.</div>
            </div>
          </div>

          <div class="card">
            <h2 class="card-title">Session Status</h2>
            <p class="card-subtitle">
              Current roleplay session and voting status.
            </p>

            <div id="overview-session-info" class="list">
              <div class="empty">No server selected.</div>
            </div>

            <div class="btn-row section-gap">
              <button
                class="btn"
                data-navigate="session-control"
              >
                Open Session Control
              </button>
            </div>
          </div>

        </div>

        <div class="card section-gap">
          <h2 class="card-title">Recent Activity</h2>
          <p class="card-subtitle">
            Latest configuration and management events.
          </p>

          <div id="overview-events" class="list">
            <div class="empty">No activity available.</div>
          </div>
        </div>

      </section>

      <!-- ==================================================
           SERVERS
      =================================================== -->

      <section class="page" id="page-servers">

        <div class="page-header">
          <div class="eyebrow">Workspace</div>
          <h1 class="page-title">Your Servers</h1>
          <p class="page-description">
            Select a Discord server where you have
            Manage Server or Administrator permission.
          </p>
        </div>

        <div class="server-grid" id="server-grid">
          <div class="empty">Loading servers...</div>
        </div>

      </section>

      <!-- ==================================================
           ER:LC CONNECTION
      =================================================== -->

      <section class="page" id="page-connection">

        <div class="page-header">
          <div class="eyebrow">ER:LC Integration</div>
          <h1 class="page-title">Connection</h1>
          <p class="page-description">
            Connect your ER:LC private server using its
            API key. Your key is encrypted before storage.
          </p>
        </div>

        <div class="grid grid-2">

          <div class="card">

            <h2 class="card-title">API Connection</h2>
            <p class="card-subtitle">
              Manage the ER:LC API connection for this Discord server.
            </p>

            <div class="field">
              <label>Connection Status</label>

              <div id="erlc-connection-display">
                <span class="status offline">
                  <span class="status-dot"></span>
                  Not Connected
                </span>
              </div>
            </div>

            <div class="field">
              <label for="erlc-api-key">ER:LC API Key</label>

              <input
                id="erlc-api-key"
                class="input"
                type="password"
                autocomplete="off"
                placeholder="Enter your private server API key"
              >

              <div class="field-description">
                The dashboard will not display your key after saving.
              </div>
            </div>

            <div class="btn-row">
              <button
                class="btn btn-primary"
                id="connect-erlc"
              >
                Connect ER:LC
              </button>

              <button
                class="btn btn-danger"
                id="disconnect-erlc"
              >
                Disconnect
              </button>
            </div>

          </div>

          <div class="card">

            <h2 class="card-title">Connection Information</h2>

            <p class="card-subtitle">
              Each Discord server has an independent ER:LC connection.
            </p>

            <div class="list">

              <div class="list-item">
                <div class="list-title">Encrypted Storage</div>
                <div class="list-subtitle">
                  API keys use AES-256-GCM encryption.
                </div>
              </div>

              <div class="list-item">
                <div class="list-title">Server Isolation</div>
                <div class="list-subtitle">
                  Configuration is separated by Discord server.
                </div>
              </div>

              <div class="list-item">
                <div class="list-title">Private API Key</div>
                <div class="list-subtitle">
                  Your saved key is never returned to the browser.
                </div>
              </div>

            </div>

          </div>

        </div>

      </section>

      <!-- ==================================================
           LIVE ER:LC
      =================================================== -->

      <section class="page" id="page-live">

        <div class="page-header">
          <div class="eyebrow">ER:LC Integration</div>
          <h1 class="page-title">Live Server</h1>
          <p class="page-description">
            Retrieve current information from your connected
            ER:LC private server.
          </p>
        </div>

        <div class="btn-row" style="margin-bottom:20px">
          <button class="btn btn-primary" id="refresh-live">
            Refresh Server Data
          </button>
        </div>

        <div class="card">
          <h2 class="card-title">ER:LC API Response</h2>
          <p class="card-subtitle">
            Live server, players, staff, queue and vehicles.
          </p>

          <pre class="pre" id="live-output">Select Refresh Server Data.</pre>
        </div>

      </section>

      <!-- ==================================================
           REMOTE CONSOLE
      =================================================== -->

      <section class="page" id="page-console">

        <div class="page-header">
          <div class="eyebrow">ER:LC Integration</div>
          <h1 class="page-title">Command Console</h1>
          <p class="page-description">
            Execute ER:LC server commands through the
            connected private server API.
          </p>
        </div>

        <div class="grid grid-2">

          <div class="card">

            <h2 class="card-title">Remote Command</h2>

            <p class="card-subtitle">
              Commands must begin with a colon.
            </p>

            <div class="field">
              <label for="remote-command">Command</label>

              <input
                class="input mono"
                id="remote-command"
                placeholder=":h Welcome to the server"
                maxlength="180"
              >
            </div>

            <button
              class="btn btn-primary"
              id="execute-command"
            >
              Execute Command
            </button>

            <hr class="divider">

            <h3 class="card-title">Response</h3>

            <pre class="pre" id="command-output">No command executed.</pre>

          </div>

          <div class="card">

            <h2 class="card-title">Command Examples</h2>

            <p class="card-subtitle">
              Examples of ER:LC administrative commands.
            </p>

            <div class="list">
              <div class="list-item mono">:h Welcome to our server</div>
              <div class="list-item mono">:m Session has started</div>
              <div class="list-item mono">:kick PlayerName Reason</div>
              <div class="list-item mono">:heal PlayerName</div>
              <div class="list-item mono">:bring PlayerName</div>
            </div>

          </div>

        </div>

      </section>

      <!-- ==================================================
           SESSION CONTROL
      =================================================== -->

      <section class="page" id="page-session-control">

        <div class="page-header">
          <div class="eyebrow">Session Management</div>
          <h1 class="page-title">Session Control</h1>
          <p class="page-description">
            Start sessions, shut them down, create votes,
            and post session boosts directly from the dashboard.
          </p>
        </div>

        <div class="grid grid-2">

          <div class="card">

            <h2 class="card-title">Current Session</h2>

            <p class="card-subtitle">
              Live session state.
            </p>

            <div id="session-status-display">
              <div class="empty">Loading...</div>
            </div>

            <hr class="divider">

            <div class="btn-row">

              <button
                class="btn btn-primary"
                data-session-action="start"
              >
                Start Session
              </button>

              <button
                class="btn"
                data-session-action="end"
              >
                End Session
              </button>

              <button
                class="btn"
                data-session-action="boost"
              >
                Boost Session
              </button>

            </div>

          </div>

          <div class="card">

            <h2 class="card-title">Session Voting</h2>

            <p class="card-subtitle">
              Create a Discord vote using Yes/No buttons.
            </p>

            <div id="vote-status-display">
              <div class="empty">Loading...</div>
            </div>

            <hr class="divider">

            <div class="btn-row">

              <button
                class="btn btn-primary"
                data-session-action="vote"
              >
                Create Vote
              </button>

              <button
                class="btn"
                data-session-action="closevote"
              >
                Close Vote
              </button>

            </div>

          </div>

        </div>

        <div class="card section-gap">

          <h2 class="card-title">Session History</h2>

          <p class="card-subtitle">
            Recent session startup, shutdown and boost events.
          </p>

          <div id="session-history" class="list">
            <div class="empty">No history available.</div>
          </div>

        </div>

      </section>

      <!-- ==================================================
           SESSION SETTINGS
      =================================================== -->

      <section class="page" id="page-session-settings">

        <div class="page-header">
          <div class="eyebrow">Session Management</div>
          <h1 class="page-title">Voting Settings</h1>
          <p class="page-description">
            Configure voting requirements, vote duration,
            automatic startup and voting behavior.
          </p>
        </div>

        <div class="grid grid-2">

          <div class="card">

            <h2 class="card-title">Vote Requirements</h2>

            <p class="card-subtitle">
              Set the number of Yes votes required.
            </p>

            <div class="field">
              <label for="session-requiredVotes">
                Required Yes Votes
              </label>

              <input
                class="input"
                type="number"
                min="1"
                max="10000"
                id="session-requiredVotes"
              >
            </div>

            <div class="field">
              <label for="session-voteDuration">
                Vote Duration (Minutes)
              </label>

              <input
                class="input"
                type="number"
                min="1"
                max="1440"
                id="session-voteDuration"
              >
            </div>

            <div class="field">
              <label for="session-joinUrl">
                Roblox Join URL (Optional)
              </label>

              <input
                class="input"
                type="url"
                id="session-joinUrl"
                placeholder="https://www.roblox.com/..."
              >

              <div class="field-description">
                Used for the optional Join Server button.
              </div>
            </div>

          </div>

          <div class="card">

            <h2 class="card-title">Voting Behavior</h2>

            <p class="card-subtitle">
              Enable or disable session voting features.
            </p>

            <div id="session-toggles"></div>

          </div>

        </div>

        <div class="btn-row section-gap">
          <button
            class="btn btn-primary"
            id="save-session-settings"
          >
            Save Voting Settings
          </button>
        </div>

      </section>

      <!-- ==================================================
           SESSION MESSAGES
      =================================================== -->

      <section class="page" id="page-session-messages">

        <div class="page-header">
          <div class="eyebrow">Session Management</div>
          <h1 class="page-title">Session Messages</h1>
          <p class="page-description">
            Customize the text displayed in every session
            announcement and voting message.
          </p>
        </div>

        <div class="card">

          <h2 class="card-title">Message Editor</h2>

          <p class="card-subtitle">
            Available placeholders:
            <span class="code">{server}</span>
            <span class="code">{prefix}</span>
            <span class="code">{required}</span>
            <span class="code">{duration}</span>
            <span class="code">{yes}</span>
            <span class="code">{no}</span>
            <span class="code">{total}</span>
          </p>

          <div class="grid grid-2" id="session-message-fields"></div>

          <div class="btn-row section-gap">
            <button
              class="btn btn-primary"
              id="save-session-messages"
            >
              Save All Messages
            </button>
          </div>

        </div>

      </section>

      <!-- ==================================================
           VOTING BUTTONS
      =================================================== -->

      <section class="page" id="page-session-buttons">

        <div class="page-header">
          <div class="eyebrow">Session Management</div>
          <h1 class="page-title">Voting Buttons</h1>
          <p class="page-description">
            Customize button labels and which buttons
            appear on your Discord session messages.
          </p>
        </div>

        <div class="grid grid-2">

          <div class="card">

            <h2 class="card-title">Button Labels</h2>

            <p class="card-subtitle">
              Change the text shown on voting buttons.
            </p>

            <div id="session-button-labels"></div>

          </div>

          <div class="card">

            <h2 class="card-title">Button Visibility</h2>

            <p class="card-subtitle">
              Choose which optional buttons are shown.
            </p>

            <div id="session-button-toggles"></div>

          </div>

        </div>

        <div class="btn-row section-gap">
          <button
            class="btn btn-primary"
            id="save-session-buttons"
          >
            Save Button Settings
          </button>
        </div>

      </section>

      <!-- ==================================================
           GENERAL SETTINGS
      =================================================== -->

      <section class="page" id="page-general">

        <div class="page-header">
          <div class="eyebrow">Configuration</div>
          <h1 class="page-title">General Settings</h1>
          <p class="page-description">
            Configure the command prefix for this Discord server.
          </p>
        </div>

        <div class="card">

          <h2 class="card-title">Command Prefix</h2>

          <p class="card-subtitle">
            Every Discord server can use a different prefix.
          </p>

          <div class="field">
            <label for="general-prefix">Prefix</label>

            <input
              class="input"
              id="general-prefix"
              maxlength="5"
              placeholder="!"
            >

            <div class="field-description">
              Example: If your prefix is -, commands will look like -help.
            </div>
          </div>

          <button
            class="btn btn-primary"
            id="save-general"
          >
            Save General Settings
          </button>

        </div>

      </section>

      <!-- ==================================================
           PERMISSIONS
      =================================================== -->

      <section class="page" id="page-permissions">

        <div class="page-header">
          <div class="eyebrow">Configuration</div>
          <h1 class="page-title">Permissions</h1>
          <p class="page-description">
            Choose which Discord roles can access staff,
            senior staff and administrator commands.
          </p>
        </div>

        <div class="card">

          <h2 class="card-title">Staff Roles</h2>

          <p class="card-subtitle">
            Discord server administrators can always
            manage Veyx.
          </p>

          <div id="permission-fields"></div>

          <button
            class="btn btn-primary"
            id="save-permissions"
          >
            Save Permissions
          </button>

        </div>

      </section>

      <!-- ==================================================
           CHANNELS
      =================================================== -->

      <section class="page" id="page-channels">

        <div class="page-header">
          <div class="eyebrow">Configuration</div>
          <h1 class="page-title">Channels</h1>
          <p class="page-description">
            Configure session announcements, voting channels,
            moderation logs and ER:LC logging channels.
          </p>
        </div>

        <div class="card">

          <h2 class="card-title">Channel Configuration</h2>

          <p class="card-subtitle">
            Select a Discord text channel for each feature.
          </p>

          <div class="grid grid-2" id="channel-fields"></div>

          <div class="btn-row section-gap">
            <button
              class="btn btn-primary"
              id="save-channels"
            >
              Save Channels
            </button>
          </div>

        </div>

      </section>

      <!-- ==================================================
           LOGGING
      =================================================== -->

      <section class="page" id="page-logging">

        <div class="page-header">
          <div class="eyebrow">Configuration</div>
          <h1 class="page-title">Logging</h1>
          <p class="page-description">
            Enable or disable available ER:LC and Veyx
            logging categories.
          </p>
        </div>

        <div class="card">

          <h2 class="card-title">Logging Preferences</h2>

          <p class="card-subtitle">
            Select which events Veyx should record.
          </p>

          <div id="logging-toggles"></div>

          <button
            class="btn btn-primary"
            id="save-logging"
          >
            Save Logging Settings
          </button>

        </div>

      </section>

      <!-- ==================================================
           STATISTICS
      =================================================== -->

      <section class="page" id="page-statistics">

        <div class="page-header">
          <div class="eyebrow">System</div>
          <h1 class="page-title">Statistics</h1>
          <p class="page-description">
            Monitor Veyx commands, staff activity,
            moderation and session usage.
          </p>
        </div>

        <div class="grid grid-4" id="statistics-grid"></div>

        <div class="btn-row section-gap">
          <button
            class="btn"
            id="refresh-statistics"
          >
            Refresh Statistics
          </button>
        </div>

      </section>

      <!-- ==================================================
           ACTIVITY
      =================================================== -->

      <section class="page" id="page-activity">

        <div class="page-header">
          <div class="eyebrow">System</div>
          <h1 class="page-title">Activity Logs</h1>
          <p class="page-description">
            Review recent management actions and
            configuration changes.
          </p>
        </div>

        <div class="btn-row" style="margin-bottom:20px">
          <button
            class="btn"
            id="refresh-activity"
          >
            Refresh Activity
          </button>
        </div>

        <div class="card">
          <div class="list" id="activity-list">
            <div class="empty">No activity available.</div>
          </div>
        </div>

      </section>

    </div>

  </main>

</div>

<div class="toast" id="toast"></div>

<script>
// ============================================================
// VEYX DASHBOARD FRONTEND
// ============================================================

const state = {
  user: null,
  guilds: [],
  guildId: null,
  guild: null,
  settings: null,
  options: {
    roles: [],
    channels: []
  },
  page: "overview"
};

// ============================================================
// DOM HELPERS
// ============================================================

const $ = id =>
  document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = String(text);
  }

  return node;
}

function clear(node) {
  node.replaceChildren();
}

function showToast(message, error = false) {
  const toast = $("toast");

  toast.textContent = message;
  toast.className =
    "toast visible" + (error ? " error" : "");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.className = "toast";
  }, 4000);
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString();
}

function formatNumber(value) {
  return Number(value || 0)
    .toLocaleString();
}

function prettyName(value) {
  return String(value)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, character =>
      character.toUpperCase()
    );
}

// ============================================================
// API CLIENT
// ============================================================

async function api(
  endpoint,
  options = {}
) {
  const response = await fetch(endpoint, {
    credentials: "same-origin",

    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },

    ...options
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server returned an invalid response."
    );
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.error || "Request failed."
    );
  }

  return data;
}

function guildApi(endpoint = "") {
  if (!state.guildId) {
    throw new Error(
      "Select a Discord server first."
    );
  }

  return (
    "/api/guild/" +
    encodeURIComponent(state.guildId) +
    endpoint
  );
}

async function patchSettings(endpoint, data) {
  return api(
    guildApi(endpoint),
    {
      method: "PATCH",
      body: JSON.stringify(data)
    }
  );
}

// ============================================================
// NAVIGATION
// ============================================================

function navigate(page) {
  state.page = page;

  document.querySelectorAll(".page")
    .forEach(node => {
      node.classList.toggle(
        "active",
        node.id === "page-" + page
      );
    });

  document.querySelectorAll(".nav-item")
    .forEach(node => {
      node.classList.toggle(
        "active",
        node.dataset.page === page
      );
    });

  $("breadcrumb-page").textContent =
    page.replace(/-/g, " ").toUpperCase();

  $("sidebar").classList.remove("open");

  if (!state.guildId && page !== "servers") {
    return;
  }

  if (page === "live") {
    refreshLive().catch(handleError);
  }

  if (page === "session-control") {
    refreshSessionStatus().catch(handleError);
  }

  if (page === "statistics") {
    refreshStatistics().catch(handleError);
  }

  if (page === "activity") {
    refreshActivity().catch(handleError);
  }
}

function handleError(error) {
  console.error(error);
  showToast(error.message, true);
}

// ============================================================
// INITIAL AUTHENTICATION
// ============================================================

async function loadUser() {
  try {
    const data = await api("/api/me");

    state.user = data.user;

    $("user-name").textContent =
      data.user.globalName ||
      data.user.username;

    $("user-avatar").textContent =
      (
        data.user.globalName ||
        data.user.username ||
        "V"
      ).charAt(0).toUpperCase();
  } catch {
    window.location.href = "/auth/login";
  }
}

// ============================================================
// SERVER SELECTION
// ============================================================

async function loadGuilds() {
  const data = await api("/api/guilds");

  state.guilds = data.guilds;

  const selector = $("server-selector");
  clear(selector);

  const placeholder =
    element("option", "", "Select a server");

  placeholder.value = "";

  selector.appendChild(placeholder);

  for (const guild of state.guilds) {
    if (!guild.botInstalled) {
      continue;
    }

    const option =
      element("option", "", guild.name);

    option.value = guild.id;

    selector.appendChild(option);
  }

  renderServerGrid();

  const saved =
    localStorage.getItem("veyx.guild");

  const selected =
    state.guilds.find(
      guild =>
        guild.id === saved &&
        guild.botInstalled
    );

  if (selected) {
    selector.value = selected.id;
    await selectGuild(selected.id);
  } else {
    navigate("servers");
  }
}

function renderServerGrid() {
  const root = $("server-grid");
  clear(root);

  if (!state.guilds.length) {
    root.appendChild(
      element(
        "div",
        "empty",
        "No manageable Discord servers found."
      )
    );

    return;
  }

  for (const guild of state.guilds) {
    const card =
      element("button", "server-card");

    card.type = "button";

    const name =
      element(
        "div",
        "server-card-name",
        guild.name
      );

    const meta =
      element(
        "div",
        "server-card-meta",
        guild.botInstalled
          ? "VEYX INSTALLED / OPEN DASHBOARD"
          : "VEYX NOT INSTALLED"
      );

    card.append(name, meta);

    if (guild.botInstalled) {
      card.addEventListener(
        "click",
        async () => {
          try {
            await selectGuild(guild.id);
            navigate("overview");
          } catch (error) {
            handleError(error);
          }
        }
      );
    } else {
      card.disabled = true;
    }

    root.appendChild(card);
  }
}

async function selectGuild(guildId) {
  state.guildId = guildId;

  localStorage.setItem(
    "veyx.guild",
    guildId
  );

  $("server-selector").value =
    guildId;

  const [overview, options] =
    await Promise.all([
      api(guildApi()),
      api(guildApi("/options"))
    ]);

  state.guild = overview.guild;
  state.settings = overview.settings;
  state.options = options;

  renderDashboard(overview);

  showToast(
    "Workspace loaded: " +
    state.guild.name
  );
}

// ============================================================
// MAIN DASHBOARD RENDER
// ============================================================

function renderDashboard(data) {
  const settings = state.settings;

  $("metric-members").textContent =
    formatNumber(
      state.guild.memberCount
    );

  $("metric-commands").textContent =
    formatNumber(
      settings.statistics.commandsExecuted
    );

  $("metric-sessions").textContent =
    formatNumber(
      settings.statistics.sessionsStarted
    );

  $("metric-votes").textContent =
    formatNumber(
      settings.statistics.votesCreated
    );

  const status =
    $("connection-status");

  status.classList.toggle(
    "offline",
    !settings.connected
  );

  $("connection-label").textContent =
    settings.connected
      ? "ER:LC CONNECTED"
      : "NOT CONNECTED";

  $("erlc-connection-display").textContent =
    settings.connected
      ? "CONNECTED"
      : "NOT CONNECTED";

  renderOverview(data);
  renderGeneral();
  renderPermissions();
  renderChannels();
  renderLogging();
  renderSessionSettings();
  renderSessionMessages();
  renderSessionButtons();
}

// ============================================================
// OVERVIEW
// ============================================================

function renderOverview(data) {
  const info =
    $("overview-server-info");

  clear(info);

  const lines = [
    ["Server", state.guild.name],
    ["Discord ID", state.guild.id],
    ["Prefix", state.settings.prefix],
    [
      "ER:LC Connection",
      state.settings.connected
        ? "Connected"
        : "Not Connected"
    ]
  ];

  for (const [name, value] of lines) {
    const item =
      element("div", "list-item");

    item.append(
      element("div", "list-title", name),
      element("div", "list-subtitle", value)
    );

    info.appendChild(item);
  }

  const sessionInfo =
    $("overview-session-info");

  clear(sessionInfo);

  const session =
    state.settings.sessions;

  const sessionLines = [
    [
      "Session",
      session.active ? "ACTIVE" : "INACTIVE"
    ],
    [
      "Required Yes Votes",
      session.requiredVotes
    ],
    [
      "Vote Duration",
      session.voteDuration + " minutes"
    ],
    [
      "Automatic Startup",
      session.autoStart ? "Enabled" : "Disabled"
    ]
  ];

  for (const [name, value] of sessionLines) {
    const item =
      element("div", "list-item");

    item.append(
      element("div", "list-title", name),
      element("div", "list-subtitle", value)
    );

    sessionInfo.appendChild(item);
  }

  renderEventList(
    $("overview-events"),
    data.recentEvents
  );
}

// ============================================================
// GENERAL SETTINGS
// ============================================================

function renderGeneral() {
  $("general-prefix").value =
    state.settings.prefix;
}

async function saveGeneral() {
  const prefix =
    $("general-prefix").value.trim();

  await patchSettings(
    "/settings",
    {
      prefix
    }
  );

  state.settings.prefix = prefix;

  showToast(
    "Command prefix updated."
  );
}

// ============================================================
// SELECT FIELD BUILDER
// ============================================================

function createSelectField(
  id,
  label,
  items,
  selected
) {
  const field =
    element("div", "field");

  const labelNode =
    element("label", "", label);

  labelNode.htmlFor = id;

  const select =
    element("select", "select");

  select.id = id;

  const none =
    element("option", "", "Not configured");

  none.value = "";

  select.appendChild(none);

  for (const item of items) {
    const option =
      element("option", "", item.name);

    option.value = item.id;

    if (selected === item.id) {
      option.selected = true;
    }

    select.appendChild(option);
  }

  field.append(
    labelNode,
    select
  );

  return field;
}

// ============================================================
// PERMISSIONS
// ============================================================

function renderPermissions() {
  const root =
    $("permission-fields");

  clear(root);

  const labels = {
    staff: "Staff Role",
    seniorStaff: "Senior Staff Role",
    administrator: "Administrator Role"
  };

  for (
    const [key, label]
    of Object.entries(labels)
  ) {
    root.appendChild(
      createSelectField(
        "role-" + key,
        label,
        state.options.roles,
        state.settings.roles[key]
      )
    );
  }
}

async function savePermissions() {
  const roles = {};

  for (
    const key of Object.keys(
      state.settings.roles
    )
  ) {
    roles[key] =
      $("role-" + key).value || null;
  }

  await patchSettings(
    "/settings",
    {
      roles
    }
  );

  state.settings.roles = roles;

  showToast(
    "Permission roles updated."
  );
}

// ============================================================
// CHANNELS
// ============================================================

function renderChannels() {
  const root =
    $("channel-fields");

  clear(root);

  for (
    const [key, value]
    of Object.entries(
      state.settings.channels
    )
  ) {
    root.appendChild(
      createSelectField(
        "channel-" + key,
        prettyName(key),
        state.options.channels,
        value
      )
    );
  }
}

async function saveChannels() {
  const channels = {};

  for (
    const key of Object.keys(
      state.settings.channels
    )
  ) {
    channels[key] =
      $("channel-" + key).value || null;
  }

  await patchSettings(
    "/settings",
    {
      channels
    }
  );

  state.settings.channels =
    channels;

  showToast(
    "Channel configuration updated."
  );
}

// ============================================================
// TOGGLE BUILDER
// ============================================================

function createToggle(
  id,
  title,
  description,
  checked
) {
  const row =
    element("div", "toggle-row");

  const info =
    element("div");

  info.append(
    element(
      "div",
      "toggle-name",
      title
    ),

    element(
      "div",
      "toggle-description",
      description
    )
  );

  const label =
    element("label", "toggle");

  const input =
    element("input");

  input.type = "checkbox";
  input.id = id;
  input.checked = !!checked;

  const slider =
    element("span", "toggle-slider");

  label.append(
    input,
    slider
  );

  row.append(
    info,
    label
  );

  return row;
}

// ============================================================
// LOGGING
// ============================================================

function renderLogging() {
  const root =
    $("logging-toggles");

  clear(root);

  for (
    const [key, value]
    of Object.entries(
      state.settings.logging
    )
  ) {
    root.appendChild(
      createToggle(
        "logging-" + key,
        prettyName(key),
        "Enable " + prettyName(key).toLowerCase() + ".",
        value
      )
    );
  }
}

async function saveLogging() {
  const logging = {};

  for (
    const key of Object.keys(
      state.settings.logging
    )
  ) {
    logging[key] =
      $("logging-" + key).checked;
  }

  await patchSettings(
    "/settings",
    {
      logging
    }
  );

  state.settings.logging =
    logging;

  showToast(
    "Logging settings updated."
  );
}

// ============================================================
// SESSION SETTINGS
// ============================================================

const SESSION_TOGGLE_DESCRIPTIONS = {
  enabled:
    "Allow Veyx to manage roleplay sessions.",

  autoStart:
    "Automatically start a session after a vote is approved.",

  allowVoteChanges:
    "Allow members to change an existing vote.",

  allowNoVotes:
    "Display the No voting button.",

  closeOnSuccess:
    "Approve the vote as soon as enough Yes votes are received.",

  oneVoteAtATime:
    "Prevent multiple active session votes."
};

function renderSessionSettings() {
  const session =
    state.settings.sessions;

  $("session-requiredVotes").value =
    session.requiredVotes;

  $("session-voteDuration").value =
    session.voteDuration;

  $("session-joinUrl").value =
    session.joinUrl || "";

  const root =
    $("session-toggles");

  clear(root);

  for (
    const [key, description]
    of Object.entries(
      SESSION_TOGGLE_DESCRIPTIONS
    )
  ) {
    root.appendChild(
      createToggle(
        "session-" + key,
        prettyName(key),
        description,
        session[key]
      )
    );
  }
}

async function saveSessionSettings() {
  const payload = {
    requiredVotes:
      Number(
        $("session-requiredVotes").value
      ),

    voteDuration:
      Number(
        $("session-voteDuration").value
      ),

    joinUrl:
      $("session-joinUrl").value.trim()
  };

  for (
    const key of Object.keys(
      SESSION_TOGGLE_DESCRIPTIONS
    )
  ) {
    payload[key] =
      $("session-" + key).checked;
  }

  const result =
    await patchSettings(
      "/sessions",
      payload
    );

  state.settings.sessions =
    result.sessions;

  showToast(
    "Session settings updated."
  );
}

// ============================================================
// SESSION MESSAGE EDITOR
// ============================================================

const SESSION_MESSAGE_LABELS = {
  voteTitle:
    "Vote Title",

  voteDescription:
    "Vote Description",

  startupTitle:
    "Startup Title",

  startupDescription:
    "Startup Description",

  shutdownTitle:
    "Shutdown Title",

  shutdownDescription:
    "Shutdown Description",

  boostTitle:
    "Boost Title",

  boostDescription:
    "Boost Description",

  approvedTitle:
    "Vote Approved Title",

  approvedDescription:
    "Vote Approved Description",

  failedTitle:
    "Vote Failed Title",

  failedDescription:
    "Vote Failed Description"
};

function renderSessionMessages() {
  const root =
    $("session-message-fields");

  clear(root);

  const messages =
    state.settings.sessions.messages;

  for (
    const [key, label]
    of Object.entries(
      SESSION_MESSAGE_LABELS
    )
  ) {
    const field =
      element("div", "field");

    const labelNode =
      element("label", "", label);

    labelNode.htmlFor =
      "message-" + key;

    const isDescription =
      key.toLowerCase()
        .includes("description");

    const input =
      element(
        isDescription
          ? "textarea"
          : "input",
        isDescription
          ? "textarea"
          : "input"
      );

    input.id =
      "message-" + key;

    input.value =
      messages[key] || "";

    input.maxLength = 1800;

    field.append(
      labelNode,
      input
    );

    root.appendChild(field);
  }
}

async function saveSessionMessages() {
  const messages = {};

  for (
    const key of Object.keys(
      SESSION_MESSAGE_LABELS
    )
  ) {
    messages[key] =
      $("message-" + key).value;
  }

  const result =
    await patchSettings(
      "/session-messages",
      messages
    );

  state.settings.sessions.messages =
    result.messages;

  showToast(
    "Session messages updated."
  );
}

// ============================================================
// SESSION BUTTON EDITOR
// ============================================================

const SESSION_BUTTON_LABELS = {
  yesLabel: "Yes Button Label",
  noLabel: "No Button Label",
  resultsLabel: "Results Button Label",
  joinLabel: "Join Button Label"
};

const SESSION_BUTTON_TOGGLES = {
  showResultsButton:
    "Show the View Results button.",

  showJoinButton:
    "Show a Join Server button when a join URL is configured."
};

function renderSessionButtons() {
  const buttons =
    state.settings.sessions.buttons;

  const labelsRoot =
    $("session-button-labels");

  const togglesRoot =
    $("session-button-toggles");

  clear(labelsRoot);
  clear(togglesRoot);

  for (
    const [key, label]
    of Object.entries(
      SESSION_BUTTON_LABELS
    )
  ) {
    const field =
      element("div", "field");

    const labelNode =
      element("label", "", label);

    labelNode.htmlFor =
      "button-" + key;

    const input =
      element("input", "input");

    input.id =
      "button-" + key;

    input.value =
      buttons[key] || "";

    input.maxLength = 80;

    field.append(
      labelNode,
      input
    );

    labelsRoot.appendChild(field);
  }

  for (
    const [key, description]
    of Object.entries(
      SESSION_BUTTON_TOGGLES
    )
  ) {
    togglesRoot.appendChild(
      createToggle(
        "button-" + key,
        prettyName(key),
        description,
        buttons[key]
      )
    );
  }
}

async function saveSessionButtons() {
  const payload = {};

  for (
    const key of Object.keys(
      SESSION_BUTTON_LABELS
    )
  ) {
    payload[key] =
      $("button-" + key).value;
  }

  for (
    const key of Object.keys(
      SESSION_BUTTON_TOGGLES
    )
  ) {
    payload[key] =
      $("button-" + key).checked;
  }

  const result =
    await patchSettings(
      "/session-buttons",
      payload
    );

  state.settings.sessions.buttons =
    result.buttons;

  showToast(
    "Voting buttons updated."
  );
}

// ============================================================
// SESSION CONTROL
// ============================================================

async function refreshSessionStatus() {
  const data =
    await api(
      guildApi("/session-status")
    );

  const sessionRoot =
    $("session-status-display");

  clear(sessionRoot);

  const sessionCard =
    element("div", "list");

  const sessionLines = [
    [
      "Session Status",
      data.active ? "ACTIVE" : "INACTIVE"
    ],
    [
      "Started",
      data.startedAt
        ? formatDate(data.startedAt)
        : "Not active"
    ]
  ];

  for (const [name, value] of sessionLines) {
    const item =
      element("div", "list-item");

    item.append(
      element("div", "list-title", name),
      element("div", "list-subtitle", value)
    );

    sessionCard.appendChild(item);
  }

  sessionRoot.appendChild(sessionCard);

  const voteRoot =
    $("vote-status-display");

  clear(voteRoot);

  if (!data.activeVote) {
    voteRoot.appendChild(
      element(
        "div",
        "empty",
        "No active session vote."
      )
    );
  } else {
    const vote = data.activeVote;

    const lines = [
      ["Vote ID", vote.id],
      [
        "Yes Votes",
        vote.counts.yes +
        " / " +
        vote.requiredVotes
      ],
      ["No Votes", vote.counts.no],
      [
        "Expires",
        formatDate(vote.expiresAt)
      ]
    ];

    for (const [name, value] of lines) {
      const item =
        element("div", "list-item");

      item.append(
        element("div", "list-title", name),
        element("div", "list-subtitle", value)
      );

      voteRoot.appendChild(item);
    }
  }

  const historyRoot =
    $("session-history");

  clear(historyRoot);

  if (!data.history.length) {
    historyRoot.appendChild(
      element(
        "div",
        "empty",
        "No session history yet."
      )
    );
  } else {
    for (const record of data.history) {
      const item =
        element("div", "list-item");

      item.append(
        element(
          "div",
          "list-title",
          record.type.toUpperCase()
        ),

        element(
          "div",
          "list-subtitle",
          formatDate(record.timestamp)
        )
      );

      historyRoot.appendChild(item);
    }
  }
}

async function runSessionAction(action) {
  const confirmations = {
    start:
      "Start the roleplay session?",

    end:
      "End the active roleplay session?",

    boost:
      "Post a session boost?",

    vote:
      "Create a new session vote?",

    closevote:
      "Close the current session vote?"
  };

  if (
    !window.confirm(
      confirmations[action] ||
      "Continue?"
    )
  ) {
    return;
  }

  const result =
    await api(
      guildApi("/session-action"),
      {
        method: "POST",

        body: JSON.stringify({
          action
        })
      }
    );

  showToast(
    result.message ||
    "Session action completed."
  );

  await refreshSessionStatus();
}

// ============================================================
// ER:LC CONNECTION
// ============================================================

async function connectErlc() {
  const apiKey =
    $("erlc-api-key").value.trim();

  if (!apiKey) {
    throw new Error(
      "Enter an ER:LC API key."
    );
  }

  await api(
    guildApi("/connect"),
    {
      method: "POST",

      body: JSON.stringify({
        apiKey
      })
    }
  );

  $("erlc-api-key").value = "";

  state.settings.connected = true;

  $("connection-label").textContent =
    "ER:LC CONNECTED";

  $("connection-status")
    .classList.remove("offline");

  $("erlc-connection-display").textContent =
    "CONNECTED";

  showToast(
    "ER:LC connected successfully."
  );
}

async function disconnectErlc() {
  if (
    !window.confirm(
      "Disconnect this server from ER:LC?"
    )
  ) {
    return;
  }

  await api(
    guildApi("/disconnect"),
    {
      method: "POST",

      body: JSON.stringify({})
    }
  );

  state.settings.connected = false;

  $("connection-label").textContent =
    "NOT CONNECTED";

  $("connection-status")
    .classList.add("offline");

  $("erlc-connection-display").textContent =
    "NOT CONNECTED";

  showToast(
    "ER:LC disconnected."
  );
}

// ============================================================
// LIVE ER:LC DATA
// ============================================================

async function refreshLive() {
  $("live-output").textContent =
    "Loading ER:LC server data...";

  try {
    const data =
      await api(
        guildApi("/live")
      );

    $("live-output").textContent =
      JSON.stringify(
        data.server,
        null,
        2
      );
  } catch (error) {
    $("live-output").textContent =
      error.message;

    throw error;
  }
}

// ============================================================
// REMOTE COMMAND CONSOLE
// ============================================================

async function executeRemote() {
  const command =
    $("remote-command").value.trim();

  if (!command) {
    throw new Error(
      "Enter an ER:LC command."
    );
  }

  $("command-output").textContent =
    "Executing command...";

  const data =
    await api(
      guildApi("/command"),
      {
        method: "POST",

        body: JSON.stringify({
          command
        })
      }
    );

  $("command-output").textContent =
    JSON.stringify(
      data.result,
      null,
      2
    );

  showToast(
    "ER:LC command submitted."
  );
}

// ============================================================
// EVENT LISTS
// ============================================================

function renderEventList(root, events) {
  clear(root);

  if (!events || !events.length) {
    root.appendChild(
      element(
        "div",
        "empty",
        "No events recorded."
      )
    );

    return;
  }

  for (const event of events) {
    const item =
      element("div", "list-item");

    item.append(
      element(
        "div",
        "list-title",
        event.type
      ),

      element(
        "div",
        "list-subtitle",
        event.description
      ),

      element(
        "div",
        "list-subtitle",
        formatDate(event.timestamp)
      )
    );

    root.appendChild(item);
  }
}

async function refreshActivity() {
  const data =
    await api(
      guildApi("/events")
    );

  renderEventList(
    $("activity-list"),
    data.events
  );
}

// ============================================================
// STATISTICS
// ============================================================

async function refreshStatistics() {
  const data =
    await api(
      guildApi("/statistics")
    );

  const root =
    $("statistics-grid");

  clear(root);

  const metrics = {
    ...data.statistics,

    activeShifts:
      data.activeShifts,

    totalWarnings:
      data.warnings,

    openCases:
      data.openCases
  };

  for (
    const [key, value]
    of Object.entries(metrics)
  ) {
    const card =
      element("div", "card");

    card.append(
      element(
        "div",
        "metric-label",
        prettyName(key)
      ),

      element(
        "div",
        "metric-value",
        formatNumber(value)
      )
    );

    root.appendChild(card);
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function bindEvents() {
  document.querySelectorAll(
    "[data-page]"
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => navigate(
        button.dataset.page
      )
    );
  });

  document.querySelectorAll(
    "[data-navigate]"
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => navigate(
        button.dataset.navigate
      )
    );
  });

  $("mobile-menu-button")
    .addEventListener(
      "click",
      () => {
        $("sidebar")
          .classList.toggle("open");
      }
    );

  $("server-selector")
    .addEventListener(
      "change",
      async event => {
        if (!event.target.value) {
          navigate("servers");
          return;
        }

        try {
          await selectGuild(
            event.target.value
          );

          navigate("overview");
        } catch (error) {
          handleError(error);
        }
      }
    );

  $("logout-button")
    .addEventListener(
      "click",
      async () => {
        try {
          await api(
            "/auth/logout",
            {
              method: "POST",
              body: JSON.stringify({})
            }
          );

          window.location.href = "/";
        } catch (error) {
          handleError(error);
        }
      }
    );

  const actions = {
    "save-general":
      saveGeneral,

    "save-permissions":
      savePermissions,

    "save-channels":
      saveChannels,

    "save-logging":
      saveLogging,

    "save-session-settings":
      saveSessionSettings,

    "save-session-messages":
      saveSessionMessages,

    "save-session-buttons":
      saveSessionButtons,

    "connect-erlc":
      connectErlc,

    "disconnect-erlc":
      disconnectErlc,

    "refresh-live":
      refreshLive,

    "execute-command":
      executeRemote,

    "refresh-statistics":
      refreshStatistics,

    "refresh-activity":
      refreshActivity
  };

  for (
    const [id, handler]
    of Object.entries(actions)
  ) {
    $(id).addEventListener(
      "click",
      async () => {
        try {
          await handler();
        } catch (error) {
          handleError(error);
        }
      }
    );
  }

  document.querySelectorAll(
    "[data-session-action]"
  ).forEach(button => {
    button.addEventListener(
      "click",
      async () => {
        try {
          await runSessionAction(
            button.dataset.sessionAction
          );
        } catch (error) {
          handleError(error);
        }
      }
    );
  });
}

// ============================================================
// INITIALIZATION
// ============================================================

async function initializeDashboard() {
  bindEvents();

  await loadUser();

  await loadGuilds();
}

initializeDashboard()
  .catch(handleError);

</script>

</body>
</html>
`;

// ============================================================
// 112. LANDING PAGE
// ============================================================

const VEYX_LANDING_HTML = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Veyx — ER:LC Management</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: #080808;
  color: #fff;
  font-family: Arial, sans-serif;
}

header {
  height: 90px;
  border-bottom: 1px solid #242424;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8%;
}

.logo {
  font-size: 27px;
  font-weight: 900;
  letter-spacing: 5px;
}

nav a {
  color: #999;
  text-decoration: none;
  margin-left: 25px;
  font-size: 13px;
}

nav a:hover {
  color: white;
}

.hero {
  max-width: 1100px;
  margin: 0 auto;
  padding: 125px 25px;
  text-align: center;
}

.eyebrow {
  color: #777;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 4px;
}

h1 {
  font-size: clamp(45px, 8vw, 95px);
  line-height: 1.05;
  letter-spacing: -5px;
  margin: 30px 0;
}

.description {
  color: #999;
  max-width: 650px;
  margin: 0 auto 35px;
  font-size: 16px;
  line-height: 1.8;
}

.actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.button {
  display: inline-block;
  background: #191919;
  color: white;
  border: 1px solid #333;
  padding: 15px 24px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 700;
  font-size: 13px;
}

.button.primary {
  background: white;
  color: black;
  border-color: white;
}

.features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-top: 90px;
  text-align: left;
}

.feature {
  background: #101010;
  border: 1px solid #292929;
  border-radius: 12px;
  padding: 25px;
}

.feature h3 {
  font-size: 15px;
}

.feature p {
  color: #888;
  font-size: 13px;
  line-height: 1.7;
}

footer {
  border-top: 1px solid #222;
  padding: 30px;
  color: #555;
  text-align: center;
  font-size: 12px;
}

@media(max-width:700px) {
  header {
    padding: 0 20px;
  }

  .features {
    grid-template-columns: 1fr;
  }

  h1 {
    letter-spacing: -2px;
  }

  .hero {
    padding: 80px 20px;
  }
}
</style>
</head>

<body>

<header>
  <div class="logo">VEYX</div>

  <nav>
    <a href="/auth/login">Login</a>
    <a href="/dashboard">Dashboard</a>
  </nav>
</header>

<section class="hero">

  <div class="eyebrow">
    ER:LC MANAGEMENT REDEFINED
  </div>

  <h1>
    CONTROL.<br>
    MANAGE.<br>
    OPERATE.
  </h1>

  <p class="description">
    Veyx is a Discord management system for
    Emergency Response: Liberty County private servers.
    Manage staff, sessions, moderation and server
    operations from one unified dashboard.
  </p>

  <div class="actions">

    <a class="button primary" href="/auth/login">
      Open Dashboard
    </a>

    <a class="button" href="/dashboard">
      Manage Servers
    </a>

  </div>

  <div class="features">

    <div class="feature">
      <h3>ER:LC Integration</h3>
      <p>
        Connect your private server and access
        server information and management commands.
      </p>
    </div>

    <div class="feature">
      <h3>Session Management</h3>
      <p>
        Run session votes, startup announcements,
        shutdowns and boosts with configurable buttons.
      </p>
    </div>

    <div class="feature">
      <h3>Complete Dashboard</h3>
      <p>
        Customize permissions, messages, logging,
        channels and voting requirements.
      </p>
    </div>

  </div>

</section>

<footer>
  VEYX MANAGEMENT SYSTEM / VERSION 6.0.0
</footer>

</body>
</html>
`;

// ============================================================
// 113. WEBSITE ROUTES
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.type("html").send(
      VEYX_LANDING_HTML
    );
  }
);

app.get(
  "/dashboard",
  (req, res) => {
    if (
      !req.session.discord ||
      !req.session.discord.user
    ) {
      return res.redirect(
        "/auth/login"
      );
    }

    return res.type("html").send(
      VEYX_DASHBOARD_HTML
    );
  }
);

// ============================================================
// 114. HEALTH ENDPOINT
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "online",

      application: "VEYX",

      version: VEYX_VERSION,

      discordReady:
        client.isReady(),

      uptime:
        process.uptime()
    });
  }
);

// ============================================================
// 115. WEBSITE 404
// ============================================================

app.use(
  (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({
        success: false,
        error: "API endpoint not found."
      });
    }

    return res.status(404).type("html").send(
      "<h1>404 / Page Not Found</h1>"
    );
  }
);

// ============================================================
// 116. DISCORD BOT READY
// ============================================================

client.once(
  Events.ClientReady,
  readyClient => {
    console.log(
      "========================================"
    );

    console.log(
      "VEYX MANAGEMENT SYSTEM"
    );

    console.log(
      "VERSION:",
      VEYX_VERSION
    );

    console.log(
      "BOT:",
      readyClient.user.tag
    );

    console.log(
      "SERVERS:",
      readyClient.guilds.cache.size
    );

    console.log(
      "DASHBOARD:",
      BASE_URL
    );

    console.log(
      "========================================"
    );
  }
);

// ============================================================
// 117. DISCORD ERROR HANDLING
// ============================================================

client.on(
  Events.Error,
  error => {
    console.error(
      "[VEYX DISCORD ERROR]",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[VEYX UNHANDLED REJECTION]",
      error
    );
  }
);

// ============================================================
// 118. DATABASE SHUTDOWN
// ============================================================

function shutdownVeyx(signal) {
  console.log(
    `[VEYX] Received ${signal}.`
  );

  try {
    flushDatabase();
  } catch (error) {
    console.error(
      "[VEYX DATABASE SHUTDOWN]",
      error
    );
  }

  client.destroy();

  process.exit(0);
}

process.on(
  "SIGINT",
  () => shutdownVeyx("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdownVeyx("SIGTERM")
);

// ============================================================
// 119. START WEB SERVER AND BOT
// ============================================================

async function startVeyx() {
  const server = app.listen(
    PORT,
    () => {
      console.log(
        `[VEYX WEB] Listening on port ${PORT}`
      );
    }
  );

  server.on(
    "error",
    error => {
      console.error(
        "[VEYX WEB]",
        error
      );
    }
  );

  try {
    await client.login(
      process.env.DISCORD_TOKEN
    );
  } catch (error) {
    console.error(
      "[VEYX LOGIN FAILED]",
      error
    );

    server.close();

    process.exitCode = 1;
  }
}

startVeyx();


