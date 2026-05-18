import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IreAmbiguousError,
  IreAuthenticationError,
  IreConfigurationError,
  IreNetworkError,
  IreNormalizedOutputError,
  IreNotFoundError,
  IreProviderError,
} from "../dist/errors.js";
import {
  BitbucketAuthenticationError,
  BitbucketConfigurationError,
  BitbucketNetworkError,
  BitbucketNormalizedOutputError,
  BitbucketPipelineNotFoundError,
  BitbucketProviderError,
  BitbucketPullRequestNotFoundError,
  BitbucketRepoAmbiguousError,
  BitbucketRepoInvalidError,
  BitbucketRepoMissingError,
} from "../dist/bitbucket.js";
import {
  JiraAuthenticationError,
  JiraConfigurationError,
  JiraIssueNotFoundError,
  JiraNetworkError,
  JiraNormalizedOutputError,
  JiraProviderError,
} from "../dist/jira.js";

test("JiraConfigurationError is an IreConfigurationError", () => {
  const err = new JiraConfigurationError(["baseUrl"]);
  assert.ok(err instanceof IreConfigurationError);
  assert.ok(err instanceof Error);
});

test("JiraAuthenticationError is an IreAuthenticationError", () => {
  const err = new JiraAuthenticationError(401);
  assert.ok(err instanceof IreAuthenticationError);
  assert.ok(err instanceof Error);
});

test("JiraIssueNotFoundError is an IreNotFoundError", () => {
  const err = new JiraIssueNotFoundError("ABC-1");
  assert.ok(err instanceof IreNotFoundError);
  assert.ok(err instanceof Error);
});

test("JiraProviderError is an IreProviderError", () => {
  const err = new JiraProviderError("fail", 500);
  assert.ok(err instanceof IreProviderError);
  assert.ok(err instanceof Error);
});

test("JiraNetworkError is an IreNetworkError", () => {
  const err = new JiraNetworkError();
  assert.ok(err instanceof IreNetworkError);
  assert.ok(err instanceof Error);
});

test("JiraNormalizedOutputError is an IreNormalizedOutputError", () => {
  const err = new JiraNormalizedOutputError([]);
  assert.ok(err instanceof IreNormalizedOutputError);
  assert.ok(err instanceof Error);
});

test("BitbucketConfigurationError is an IreConfigurationError", () => {
  const err = new BitbucketConfigurationError(["workspace"]);
  assert.ok(err instanceof IreConfigurationError);
  assert.ok(err instanceof Error);
});

test("BitbucketRepoMissingError is an IreConfigurationError", () => {
  const err = new BitbucketRepoMissingError();
  assert.ok(err instanceof IreConfigurationError);
  assert.ok(err instanceof Error);
});

test("BitbucketRepoInvalidError is an IreConfigurationError", () => {
  const err = new BitbucketRepoInvalidError("bad-repo");
  assert.ok(err instanceof IreConfigurationError);
  assert.ok(err instanceof Error);
});

test("BitbucketRepoAmbiguousError is an IreAmbiguousError", () => {
  const err = new BitbucketRepoAmbiguousError([]);
  assert.ok(err instanceof IreAmbiguousError);
  assert.ok(err instanceof Error);
});

test("BitbucketAuthenticationError is an IreAuthenticationError", () => {
  const err = new BitbucketAuthenticationError(403);
  assert.ok(err instanceof IreAuthenticationError);
  assert.ok(err instanceof Error);
});

test("BitbucketPullRequestNotFoundError is an IreNotFoundError", () => {
  const err = new BitbucketPullRequestNotFoundError(42, { workspace: "ws", repo: "r" });
  assert.ok(err instanceof IreNotFoundError);
  assert.ok(err instanceof Error);
});

test("BitbucketPipelineNotFoundError is an IreNotFoundError", () => {
  const err = new BitbucketPipelineNotFoundError({ workspace: "ws", repo: "r" });
  assert.ok(err instanceof IreNotFoundError);
  assert.ok(err instanceof Error);
});

test("BitbucketProviderError is an IreProviderError", () => {
  const err = new BitbucketProviderError("fail", 500);
  assert.ok(err instanceof IreProviderError);
  assert.ok(err instanceof Error);
});

test("BitbucketNetworkError is an IreNetworkError", () => {
  const err = new BitbucketNetworkError();
  assert.ok(err instanceof IreNetworkError);
  assert.ok(err instanceof Error);
});

test("BitbucketNormalizedOutputError is an IreNormalizedOutputError", () => {
  const err = new BitbucketNormalizedOutputError([]);
  assert.ok(err instanceof IreNormalizedOutputError);
  assert.ok(err instanceof Error);
});
