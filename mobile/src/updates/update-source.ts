export type UpdateSourceConfig = {
  updateRepository?: string;
  updateFeedUrl?: string;
};

export function requireHttpsUpdateUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Update URLs must use HTTPS without embedded credentials or fragments");
  }
  return url.toString();
}

export function resolveUpdateSource(config?: UpdateSourceConfig): { repository: string; feedUrl: string } {
  const repository = config?.updateRepository?.trim() || "mypengpengli/myyaya";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || [".", ".."].includes(repository.split("/")[1])) {
    throw new Error("Invalid update repository");
  }
  const customFeed = config?.updateFeedUrl?.trim();
  return {
    repository,
    feedUrl: requireHttpsUpdateUrl(customFeed || `https://api.github.com/repos/${repository}/releases/latest`),
  };
}
