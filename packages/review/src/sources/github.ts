import { type AnyTool, defineTool } from '@pkgwarden/engine';
import { z } from 'zod';
import type { HttpClient } from '../http/client.js';
import { RecentCommits, RecentIssues, Releases, RepoFacts } from './outputs.js';
import { GitHubCommits, GitHubIssues, GitHubReleases, GitHubRepo } from './responses.js';

const HOUR = 3_600_000;
const RepoInput = z.object({
  owner: z.string().regex(/^[\w.-]+$/),
  repo: z.string().regex(/^[\w.-]+$/),
});

const oneLine = (text: string, max = 120) => {
  const first = text.split('\n')[0] ?? '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
};

/** Read-only GitHub lookups for the maintenance judge. Titles and messages are untrusted text. */
export function githubTools(http: HttpClient): AnyTool[] {
  const api = (path: string, signal: AbortSignal) => http.json(`https://api.github.com${path}`, {}, signal);

  const repo = defineTool({
    id: 'github.repo',
    description: 'Basic facts about a GitHub repository: archived or not, last push, open issues, stars.',
    input: RepoInput,
    output: RepoFacts,
    cache: { kind: 'ttl', ttlMs: HOUR },
    async run(input, ctx) {
      const res = await api(`/repos/${input.owner}/${input.repo}`, ctx.signal);
      if (res.status === 404) return { found: false };
      if (res.status !== 200) throw new Error(`GitHub answered ${res.status}`);
      const r = GitHubRepo.parse(res.body);
      return {
        found: true,
        archived: r.archived,
        ...(r.pushed_at ? { pushedAt: r.pushed_at } : {}),
        openIssues: r.open_issues_count,
        stars: r.stargazers_count,
      };
    },
  });

  const recentCommits = defineTool({
    id: 'github.recentCommits',
    description: 'The 10 most recent commits on the default branch: date and first line of the message.',
    input: RepoInput,
    output: RecentCommits,
    cache: { kind: 'ttl', ttlMs: HOUR },
    async run(input, ctx) {
      const res = await api(`/repos/${input.owner}/${input.repo}/commits?per_page=10`, ctx.signal);
      if (res.status !== 200) throw new Error(`GitHub answered ${res.status}`);
      return {
        commits: GitHubCommits.parse(res.body).map(c => ({
          sha: c.sha.slice(0, 7),
          date: c.commit.author?.date ?? '',
          message: oneLine(c.commit.message),
        })),
      };
    },
  });

  const recentIssues = defineTool({
    id: 'github.recentIssues',
    description: 'The 10 most recently updated issues and pull requests, with state and comment count.',
    input: RepoInput,
    output: RecentIssues,
    cache: { kind: 'ttl', ttlMs: HOUR },
    async run(input, ctx) {
      const res = await api(
        `/repos/${input.owner}/${input.repo}/issues?state=all&sort=updated&per_page=10`,
        ctx.signal
      );
      if (res.status !== 200) throw new Error(`GitHub answered ${res.status}`);
      return {
        issues: GitHubIssues.parse(res.body).map(i => ({
          number: i.number,
          title: oneLine(i.title),
          state: i.state,
          updatedAt: i.updated_at,
          comments: i.comments,
          pullRequest: i.pull_request !== undefined,
        })),
      };
    },
  });

  const releases = defineTool({
    id: 'github.releases',
    description: 'The 5 most recent GitHub releases: tag and publish date.',
    input: RepoInput,
    output: Releases,
    cache: { kind: 'ttl', ttlMs: HOUR },
    async run(input, ctx) {
      const res = await api(`/repos/${input.owner}/${input.repo}/releases?per_page=5`, ctx.signal);
      if (res.status !== 200) throw new Error(`GitHub answered ${res.status}`);
      return {
        releases: GitHubReleases.parse(res.body).map(r => ({ tag: r.tag_name, publishedAt: r.published_at ?? '' })),
      };
    },
  });

  return [repo, recentCommits, recentIssues, releases];
}
