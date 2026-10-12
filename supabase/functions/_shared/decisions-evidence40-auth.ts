// Read active-user state through the server Auth Admin API, never auth.users SQL.
export interface Evidence40AuthReader {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: {
          user:
            | { id: string; deleted_at?: string; banned_until?: string }
            | null;
        };
        error: unknown;
      }>;
    };
  };
}
export async function assertEvidence40ActiveUser(
  admin: Evidence40AuthReader,
  userId: string,
  now = Date.now(),
) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  const user = data.user;
  if (
    error || !user || user.id !== userId || user.deleted_at ||
    user.banned_until &&
      (!Number.isFinite(Date.parse(user.banned_until)) ||
        Date.parse(user.banned_until) > now)
  ) {
    throw new Error("FORBIDDEN");
  }
}
