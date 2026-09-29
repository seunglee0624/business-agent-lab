"""Builds build/harbortrade-<version>.mrpack: the mods in mods.json and their required dependencies
(resolved from Modrinth for this Minecraft version and Fabric) plus the locally built Harbor Trade jar.
Run after ./gradlew build."""
import json
import pathlib
import urllib.parse
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.modrinth.com/v2"


def gradle_props():
	props = {}
	for line in (ROOT / "gradle.properties").read_text().splitlines():
		if "=" in line and not line.startswith("#"):
			key, value = line.split("=", 1)
			props[key.strip()] = value.strip()
	return props


def get_json(url):
	req = urllib.request.Request(url, headers={"User-Agent": "harbortrade-modpack-builder"})
	with urllib.request.urlopen(req) as resp:
		return json.load(resp)


def latest_version(project, mc_version):
	"""Newest Fabric version of the project for mc_version, preferring releases over betas."""
	query = urllib.parse.urlencode({"loaders": '["fabric"]', "game_versions": f'["{mc_version}"]'})
	versions = get_json(f"{API}/project/{project}/version?{query}")
	releases = [v for v in versions if v["version_type"] == "release"] or versions
	if not releases:
		raise SystemExit(f"{project}: no Fabric {mc_version} version on Modrinth")
	return releases[0]


def main():
	props = gradle_props()
	mc_version = props["minecraft_version"]
	mod_version = props["version"]
	config = json.loads((ROOT / "modpack" / "mods.json").read_text(encoding="utf-8"))

	files = []
	seen = set()
	# (project, side) pairs; side is "both", "client" or "server". Dependencies inherit their parent's side.
	queue = [(mod["slug"], mod.get("side", "both")) for mod in config["mods"]]
	while queue:
		project, side = queue.pop(0)
		version = latest_version(project, mc_version)
		if version["project_id"] in seen:
			continue
		seen.add(version["project_id"])
		queue += [(d["project_id"], side) for d in version["dependencies"] if d["dependency_type"] == "required" and d["project_id"]]

		file = next((f for f in version["files"] if f["primary"]), version["files"][0])
		files.append({
			"path": f"mods/{file['filename']}",
			"hashes": {"sha1": file["hashes"]["sha1"], "sha512": file["hashes"]["sha512"]},
			"env": {
				"client": "unsupported" if side == "server" else "required",
				"server": "unsupported" if side == "client" else "required",
			},
			"downloads": [file["url"]],
			"fileSize": file["size"],
		})
		print(f"{file['filename']} ({version['version_type']}, {side})")

	jar = ROOT / "build" / "libs" / f"harbortrade-{mod_version}.jar"
	if not jar.exists():
		raise SystemExit(f"{jar} not found; run ./gradlew build first")

	index = {
		"formatVersion": 1,
		"game": "minecraft",
		"versionId": mod_version,
		"name": config["name"],
		"files": files,
		"dependencies": {"minecraft": mc_version, "fabric-loader": props["loader_version"]},
	}

	out = ROOT / "build" / f"harbortrade-{mod_version}.mrpack"
	with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
		zf.writestr("modrinth.index.json", json.dumps(index, indent=2, ensure_ascii=False))
		zf.write(jar, f"overrides/mods/{jar.name}")
	print(f"wrote {out}")


if __name__ == "__main__":
	main()
