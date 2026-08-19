import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/patch-writer.ts
/**
* Pure patch-layer helpers for the dsh skin switcher.
*
* The user patch layers (`$DSH_HOME/cordis.patch.yml` and
* `$DSH_HOME/profiles/<name>/cordis.patch.yml`) are YAML lists of loader
* patch entries. Each installed skin owns one row shaped like
*
*   - id: ui-skin-<skinId>
*     disabled: true|false
*
* A skin with NO row anywhere is ENABLED by the loader by default, so
* "only one skin active" requires an explicit `disabled: true` row for every
* inactive skin, in both layers (the home layer overrides the profile layer).
* These helpers edit the rows in place and preserve every other byte
* (comments, unknown rows, formatting) so switching never disturbs
* unrelated configuration.
*/
/** One `- id:` row opener (also matches rows that are not skins). */
const ROW_ID_RE = /^\s*-\s*id:\s*(.+?)\s*$/;
/** A `disabled:` field inside a row. */
const DISABLED_RE = /^(\s*)disabled:\s*(true|false)\s*$/;
/** Skin row ids live under `ui-skin-`; the switcher itself never matches. */
function skinRowId(skinId) {
	return `ui-skin-${skinId}`;
}
/** Parse a patch layer into `{ rowId -> disabled }`. Later rows with the same id win. */
function parsePatchRows(content) {
	const rows = /* @__PURE__ */ new Map();
	let currentId;
	for (const line of content.split(/\r?\n/)) {
		const idMatch = ROW_ID_RE.exec(line);
		if (idMatch !== null) {
			currentId = idMatch[1].trim();
			continue;
		}
		const disabledMatch = DISABLED_RE.exec(line);
		if (disabledMatch !== null && currentId !== void 0) rows.set(currentId, disabledMatch[2] === "true");
	}
	return rows;
}
/**
* Resolve the active skin id from both layers (home overrides profile).
* A skin with no row is enabled by default; when several are enabled the
* first one wins (the switcher UI offers an explicit choice anyway).
* @param skinIds - installed skin ids in profile bundle order.
* @param profileContent - profile patch layer, or '' when absent.
* @param homeContent - home patch layer, or '' when absent.
* @returns the active skin id, or 'none' when no skin is enabled.
*/
function resolveCurrent(skinIds, profileContent, homeContent) {
	const profileRows = parsePatchRows(profileContent);
	const homeRows = parsePatchRows(homeContent);
	return skinIds.filter((skinId) => {
		return !(homeRows.get(skinRowId(skinId)) ?? profileRows.get(skinRowId(skinId)) ?? false);
	})[0] ?? "none";
}
/**
* Rewrite one patch layer so the given choice is active:
*   target 'none'    -> every installed skin gets `disabled: true`
*   target <skinId>  -> that skin gets `disabled: false`, every other skin `true`
* Existing skin rows are updated in place (their `disabled:` line, or an
* inserted one right after the `- id:` line); skins missing from the file
* get a new row appended. Comments and unrelated rows are preserved
* verbatim. Returns the full next content of the file.
*/
function applySkinChoice(content, skinIds, target) {
	const out = [...content === "" ? [] : content.split("\n")];
	const blockStarts = [];
	for (let i = 0; i < out.length; i++) if (ROW_ID_RE.test(out[i])) blockStarts.push(i);
	const blocks = blockStarts.map((start, index) => ({
		start,
		end: index + 1 < blockStarts.length ? blockStarts[index + 1] : out.length,
		id: ROW_ID_RE.exec(out[start])[1].trim()
	}));
	const seen = /* @__PURE__ */ new Set();
	for (const block of blocks) {
		const rowId = block.id;
		const skinId = skinIds.find((candidate) => skinRowId(candidate) === rowId);
		if (skinId === void 0) continue;
		seen.add(skinId);
		const wantDisabled = target === "none" || target !== skinId;
		let patched = false;
		for (let i = block.start + 1; i < block.end; i++) {
			const match = DISABLED_RE.exec(out[i]);
			if (match === null) continue;
			out[i] = `${match[1]}disabled: ${wantDisabled}`;
			patched = true;
			break;
		}
		if (!patched) out.splice(block.start + 1, 0, `  disabled: ${wantDisabled}`);
	}
	for (const skinId of skinIds) {
		if (seen.has(skinId)) continue;
		if (out.length > 0 && out[out.length - 1] !== "") out.push("");
		out.push(`- id: ${skinRowId(skinId)}`, `  disabled: ${target === "none" || target !== skinId}`);
	}
	return out.join("\n");
}
//#endregion
//#region src/index.ts
/**
* dsh-skin-switcher — host half.
*
* Registers two web routes on the dsh web server:
*
*   GET  /dsh-skin/state   -> installed skins (from the profile's linked
*                             skin bundles and their skin.json) plus the
*                             currently active skin id.
*   POST /dsh-skin/switch  -> body `{ "target": <skinId|'none'> }`; rewrites
*                             BOTH user patch layers (profile + home) so the
*                             loader's patch watcher hot-applies the choice.
*                             No restart, no service/event/model-touch.
*
* Presentation-adjacent only: it edits the same config rows a human would
* edit by hand, and changes nothing else about the harness.
*/
/** Stable Cordis plugin name. */
const name = "dsh-skin-switcher";
/** The web routes need the HTTP carrier. */
const inject = ["webServer"];
/** Profile whose patch layers the switcher drives (the shipped web GUI). */
const PROFILE_NAME = "web";
/** Only these bundles are skins; the switcher itself is excluded by skin.json presence. */
const SKIN_PACKAGE_PREFIX = "@dsh-external/dsh-client-ui-skin-";
function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
function profileDir() {
	return join(dshHome(), "profiles", PROFILE_NAME);
}
function profilePatchPath() {
	return join(profileDir(), "cordis.patch.yml");
}
function homePatchPath() {
	return join(dshHome(), "cordis.patch.yml");
}
/** Both user layers, profile first (home overrides it in the loader). */
function patchLayerPaths() {
	return [profilePatchPath(), homePatchPath()];
}
function readFileSafe(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return;
	}
}
/** Profile bundle list, in composition order. */
function readProfileBundles() {
	const content = readFileSafe(join(profileDir(), "package.json"));
	if (content === void 0) return [];
	try {
		const bundles = JSON.parse(content).dsh?.profile?.bundles;
		return Array.isArray(bundles) ? bundles.filter((entry) => typeof entry === "string") : [];
	} catch {
		return [];
	}
}
/** Discover installed skins by their skin.json inside the linked bundles. */
function discoverSkins() {
	const skins = [];
	for (const bundle of readProfileBundles()) {
		if (!bundle.startsWith(SKIN_PACKAGE_PREFIX)) continue;
		const skinJsonPath = join(profileDir(), "node_modules", bundle, "skin.json");
		if (!existsSync(skinJsonPath)) continue;
		try {
			const raw = JSON.parse(readFileSync(skinJsonPath, "utf8"));
			if (typeof raw.id !== "string" || raw.id.length === 0) continue;
			skins.push({
				id: raw.id,
				name: typeof raw.name === "string" ? raw.name : raw.id,
				nameEn: typeof raw.nameEn === "string" ? raw.nameEn : raw.id,
				tagline: typeof raw.tagline === "string" ? raw.tagline : ""
			});
		} catch {}
	}
	return skins;
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}
/**
* Apply the chosen skin to both user patch layers. Missing layers are
* created (the home layer is optional); existing content is preserved.
* @returns the new active skin id on success.
*/
function applyChoice(skins, target) {
	const ids = skins.map((skin) => skin.id);
	for (const path of patchLayerPaths()) {
		const next = applySkinChoice(readFileSafe(path) ?? "", ids, target);
		writeFileSync(path, next, "utf8");
	}
	return target;
}
/** Host plugin body. */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-skin/state",
		handler: (req, res) => {
			if (req.method !== "GET") {
				res.writeHead(405);
				res.end();
				return;
			}
			const skins = discoverSkins();
			const profile = readFileSafe(profilePatchPath()) ?? "";
			const home = readFileSafe(homePatchPath()) ?? "";
			json(res, 200, {
				skins: skins.map(({ id, name, nameEn, tagline }) => ({
					id,
					name,
					nameEn,
					tagline
				})),
				current: resolveCurrent(skins.map((skin) => skin.id), profile, home)
			});
		}
	}), "dsh-skin-switcher: state route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-skin/switch",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405);
				res.end();
				return;
			}
			let payload;
			try {
				payload = JSON.parse(await readBody(req));
			} catch {
				json(res, 400, {
					ok: false,
					error: "invalid JSON body"
				});
				return;
			}
			const target = payload.target;
			const skins = discoverSkins();
			const known = skins.some((skin) => skin.id === target) || target === "none";
			if (typeof target !== "string" || !known) {
				json(res, 400, {
					ok: false,
					error: `unknown skin target: ${String(target)}`
				});
				return;
			}
			try {
				applyChoice(skins, target);
			} catch (error) {
				ctx.logger.warn(error instanceof Error ? error : new Error(String(error)));
				json(res, 500, {
					ok: false,
					error: "failed to write patch layers"
				});
				return;
			}
			json(res, 200, {
				ok: true,
				current: target
			});
		}
	}), "dsh-skin-switcher: switch route");
}
//#endregion
export { apply, inject, name };
