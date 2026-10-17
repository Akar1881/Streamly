var ENDPOINT = "https://api.vidlove.cc";

var HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Referer":    "https://player.vidlove.cc/",
    "Origin":     "https://player.vidlove.cc"
};

var SOURCES = [
    { key: "moviebox2", label: "MovieBox 2" },
    { key: "moviebox",  label: "MovieBox" },
    { key: "dcloud",    label: "DCloud" },
    { key: "tcloud",    label: "TCloud" },
    { key: "vidapi",    label: "VidAPI" }
];

function buildUrl(base, src) {
    var url = base + "&sources=" + src.key;
    if (src.key === "moviebox" || src.key === "moviebox2") url += "&vh=1&hevc=1";
    if (src.key === "dcloud") url += "&sw=1";
    return url;
}

function fetchJson(url) {
    return fetch(url, { headers: HEADERS })
        .then(function(r) {
            return r.text().then(function(body) {
                if (!r.ok) {
                    console.log("[VID][HTTP] " + r.status + " " + url);
                    return null;
                }
                try { return JSON.parse(body); } catch (e) { return null; }
            });
        })
        .catch(function(e) {
            console.log("[VID][FETCH] " + (e.message || e));
            return null;
        });
}

function variants(manifest) {
    var lines = String(manifest || "").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var bw = /BANDWIDTH=(\d+)/.exec(lines[i]);
        var res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
        var codecs = /CODECS="([^"]+)"/.exec(lines[i]);
        var uri = null;
        for (var j = i + 1; j < lines.length; j++) {
            var next = lines[j].trim();
            if (next && next[0] !== "#") { uri = next; break; }
        }
        if (uri) {
            out.push({
                uri: uri,
                bandwidth: bw ? parseInt(bw[1], 10) : 0,
                width: res ? parseInt(res[1], 10) : 0,
                height: res ? parseInt(res[2], 10) : 0,
                codecs: codecs ? codecs[1] : ""
            });
        }
    }
    return out;
}

function labelFor(v) {
    if (v.width >= 3800) return "4K";
    if (v.width >= 1900) return "1080p";
    if (v.width >= 1260) return "720p";
    if (v.width >= 840) return "480p";
    if (v.width >= 620) return "360p";
    return v.height ? v.height + "p" : null;
}

function audioFromCodecs(codecs) {
    var c = String(codecs || "").toLowerCase();
    if (c.indexOf("ec-3") !== -1 || c.indexOf("ac-3") !== -1) return "DD";
    if (c.indexOf("mp4a") !== -1) return "AAC";
    if (c.indexOf("opus") !== -1) return "Opus";
    return null;
}

function describe(src, list) {
    var sorted = list.slice().sort(function(a, b) { return a.width - b.width; });
    var labels = [];
    for (var i = 0; i < sorted.length; i++) {
        var l = labelFor(sorted[i]);
        if (l && labels.indexOf(l) === -1) labels.push(l);
    }
    var best = null;
    for (var j = 0; j < list.length; j++) {
        if (!best || list[j].bandwidth > best.bandwidth) best = list[j];
    }
    var quality = best ? (labelFor(best) || "auto") : "auto";
    var audio = null;
    for (var k = 0; k < list.length; k++) {
        audio = audioFromCodecs(list[k].codecs);
        if (audio) break;
    }
    var parts = [src.label];
    if (labels.length) parts.push(labels.join(" / "));
    if (audio) parts.push(audio);
    return { quality: quality, bestUri: best ? best.uri : null, detail: parts.join(" · ") };
}

function toSubtitles(tracks) {
    if (!Array.isArray(tracks)) return [];
    return tracks
        .filter(function(t) { return t && t.file; })
        .map(function(t) {
            return {
                url: t.file,
                language: t.lang || t.srclang || "en",
                name: t.label || "Subtitle"
            };
        });
}

function getStreams(tmdbId, mediaType, season, episode) {
    var isTv = (mediaType === "tv" || mediaType === "series");
    var base = isTv
        ? ENDPOINT + "/tv?id=" + tmdbId + "&season=" + season + "&episode=" + episode + "&mode=json"
        : ENDPOINT + "/movie?id=" + tmdbId + "&mode=json";
    var subsEndpoint = isTv
        ? ENDPOINT + "/subtitles/tv/" + tmdbId + "/" + season + "/" + episode
        : ENDPOINT + "/subtitles/movie/" + tmdbId;

    var tasks = SOURCES.map(function(src) {
        return fetchJson(buildUrl(base, src)).then(function(payload) {
            var source = payload && payload.source;
            if (!source) return null;

            var list = source.manifest ? variants(source.manifest) : [];
            var info = describe(src, list);
            var playUrl = source.url || info.bestUri;
            if (!playUrl) return null;

            console.log("[VID][OK] source=" + src.key + " quality=" + info.quality + " detail=" + info.detail);
            return {
                name: "Vidlove",
                title: info.detail,
                url: playUrl,
                quality: info.quality,
                language: info.detail,
                type: "hls",
                headers: HEADERS,
                subtitles: toSubtitles(payload && payload.subtitles)
            };
        });
    });

    tasks.push(fetchJson(subsEndpoint).then(function(list) {
        if (!Array.isArray(list)) return [];
        return list.filter(function(s) { return s && s.file; }).map(function(s) {
            return { url: s.file, language: s.lang || s.srclang || "en", name: s.label || "Subtitle" };
        });
    }));

    return Promise.all(tasks).then(function(results) {
        var streams = [];
        var allSubs = [];
        var seenSub = {};

        for (var i = 0; i < results.length; i++) {
            var item = results[i];
            if (!item) continue;
            if (Array.isArray(item)) {
                for (var a = 0; a < item.length; a++) {
                    if (!seenSub[item[a].url]) { seenSub[item[a].url] = true; allSubs.push(item[a]); }
                }
            } else {
                streams.push(item);
            }
        }

        streams.sort(function(a, b) {
            var order = {};
            for (var s = 0; s < SOURCES.length; s++) order[SOURCES[s].label] = s;
            return (order[a.title.split(" · ")[0]] || 99) - (order[b.title.split(" · ")[0]] || 99);
        });

        for (var v = 0; v < streams.length; v++) {
            var merged = allSubs.slice();
            var own = streams[v].subtitles || [];
            for (var w = 0; w < own.length; w++) {
                if (!seenSub[own[w].url]) { seenSub[own[w].url] = true; merged.push(own[w]); }
            }
            streams[v].subtitles = merged;
        }

        console.log("[VID][RETURN] streams=" + streams.length + " subs=" + allSubs.length);
        return streams;
    }).catch(function(err) {
        console.error("[VID][ERROR] " + (err.message || err));
        return [];
    });
}

module.exports = { getStreams: getStreams };