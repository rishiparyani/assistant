// Better Auth's tables, mirrored in Drizzle so one migration history covers the whole
// database. Names and types follow Better Auth exactly (camelCase columns, `date`
// type); test/auth-schema.test.ts fails if Better Auth expects anything missing.
// Workspaces = `organization` rows (with `kind`); memberships = `member` rows.
import { customType, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Better Auth's SQLite dialect declares timestamps as `date` and stores ISO strings.
const date = customType<{ data: string; driverData: string }>({ dataType: () => "date" });
const bool = (name: string) => integer(name, { mode: "boolean" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: bool("emailVerified").notNull(),
  image: text("image"),
  createdAt: date("createdAt").notNull(),
  updatedAt: date("updatedAt").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: date("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: date("createdAt").notNull(),
    updatedAt: date("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("activeOrganizationId"),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: date("accessTokenExpiresAt"),
    refreshTokenExpiresAt: date("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: date("createdAt").notNull(),
    updatedAt: date("updatedAt").notNull(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: date("expiresAt").notNull(),
    createdAt: date("createdAt").notNull(),
    updatedAt: date("updatedAt").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** A workspace: `kind` is "personal" or "band". */
export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: date("createdAt").notNull(),
  metadata: text("metadata"),
  kind: text("kind"),
});

/** A workspace membership with role "owner" or "member". */
export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: date("createdAt").notNull(),
  },
  (t) => [index("member_organizationId_idx").on(t.organizationId), index("member_userId_idx").on(t.userId)],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: date("expiresAt").notNull(),
    createdAt: date("createdAt").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("invitation_organizationId_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ],
);

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: date("createdAt").notNull(),
  expiresAt: date("expiresAt"),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClient = sqliteTable(
  "oauthClient",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId").notNull().unique(),
    clientSecret: text("clientSecret"),
    clientDiscoveryId: text("clientDiscoveryId"),
    disabled: bool("disabled"),
    skipConsent: bool("skipConsent"),
    enableEndSession: bool("enableEndSession"),
    subjectType: text("subjectType"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("clientCredentialsScopes"),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    createdAt: date("createdAt"),
    updatedAt: date("updatedAt"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("softwareId"),
    softwareVersion: text("softwareVersion"),
    softwareStatement: text("softwareStatement"),
    redirectUris: text("redirectUris").notNull(),
    postLogoutRedirectUris: text("postLogoutRedirectUris"),
    backchannelLogoutUri: text("backchannelLogoutUri"),
    backchannelLogoutSessionRequired: bool("backchannelLogoutSessionRequired"),
    tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
    applicationType: text("applicationType"),
    jwks: text("jwks"),
    jwksUri: text("jwksUri"),
    grantTypes: text("grantTypes"),
    responseTypes: text("responseTypes"),
    requirePKCE: bool("requirePKCE"),
    dpopBoundAccessTokens: bool("dpopBoundAccessTokens"),
    referenceId: text("referenceId"),
    metadata: text("metadata"),
  },
  (t) => [index("oauthClient_userId_idx").on(t.userId)],
);

export const oauthResource = sqliteTable("oauthResource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("accessTokenTtl"),
  refreshTokenTtl: integer("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes"),
  customClaims: text("customClaims"),
  dpopBoundAccessTokensRequired: bool("dpopBoundAccessTokensRequired"),
  disabled: bool("disabled"),
  createdAt: date("createdAt"),
  updatedAt: date("updatedAt"),
  policyVersion: integer("policyVersion"),
  metadata: text("metadata"),
});

export const oauthClientResource = sqliteTable(
  "oauthClientResource",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resourceId")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text("metadata"),
    createdAt: date("createdAt"),
  },
  (t) => [
    index("oauthClientResource_clientId_idx").on(t.clientId),
    index("oauthClientResource_resourceId_idx").on(t.resourceId),
    uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(t.clientId, t.resourceId),
  ],
);

export const oauthRefreshToken = sqliteTable(
  "oauthRefreshToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    expiresAt: date("expiresAt").notNull(),
    createdAt: date("createdAt").notNull(),
    revoked: date("revoked"),
    rotatedAt: date("rotatedAt"),
    rotationReplayResponse: text("rotationReplayResponse"),
    rotationReplayExpiresAt: date("rotationReplayExpiresAt"),
    authTime: date("authTime"),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauthRefreshToken_clientId_idx").on(t.clientId),
    index("oauthRefreshToken_sessionId_idx").on(t.sessionId),
    index("oauthRefreshToken_userId_idx").on(t.userId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessToken = sqliteTable(
  "oauthAccessToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    refreshId: text("refreshId").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: date("expiresAt").notNull(),
    createdAt: date("createdAt").notNull(),
    revoked: date("revoked"),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauthAccessToken_clientId_idx").on(t.clientId),
    index("oauthAccessToken_sessionId_idx").on(t.sessionId),
    index("oauthAccessToken_userId_idx").on(t.userId),
    index("oauthAccessToken_authorizationCodeId_idx").on(t.authorizationCodeId),
    index("oauthAccessToken_refreshId_idx").on(t.refreshId),
  ],
);

export const oauthConsent = sqliteTable(
  "oauthConsent",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requestedUserInfoClaims"),
    scopes: text("scopes").notNull(),
    createdAt: date("createdAt").notNull(),
    updatedAt: date("updatedAt").notNull(),
  },
  (t) => [index("oauthConsent_clientId_idx").on(t.clientId), index("oauthConsent_userId_idx").on(t.userId)],
);

export const oauthClientAssertion = sqliteTable("oauthClientAssertion", {
  id: text("id").primaryKey(),
  expiresAt: date("expiresAt").notNull(),
});
