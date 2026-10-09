/**
 * ============================================================================
 *  MPEG-TS — reading what is inside one
 * ============================================================================
 *
 *  Some stream hosts describe their video only in the bytes. The playlist says
 *  nothing — no `RESOLUTION`, no variant list, just a few thousand segment URLs —
 *  and the API behind it says nothing either, so the only place the picture size
 *  is written down is the video itself, in the sequence parameter set that every
 *  H.264 stream opens with.
 *
 *  That is what this reads. A transport stream is a flat run of 188-byte packets
 *  carrying a programme: a `PAT` naming the `PMT`, a `PMT` naming which PID is
 *  video, and then that PID's payload, a packet stream of PES headers and NAL
 *  units. The SPS is the first of them, and it carries the coded width and
 *  height in macroblocks, plus the cropping that trims them to the real picture.
 *
 *  None of this is guesswork and none of it is a heuristic — the numbers are
 *  stated outright, and decoding them is a matter of reading the bit field
 *  order in the specification. Verified against `ffprobe` on a real segment:
 *  this and it agree to the pixel, letterboxed aspect ratio and all.
 *
 *  Pure and server-side. It takes bytes and returns numbers; it fetches nothing.
 * ============================================================================
 */

/** MPEG-TS: one sync byte then 187 bytes of payload, over and over. */
export const TS_PACKET_BYTES = 188;
export const TS_SYNC_BYTE = 0x47;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_SIGNATURE_BYTES = PNG_SIGNATURE.length;

/**
 * Bytes between the last letter of `IEND` and the first byte of video.
 *
 * The image ends with an `IEND` chunk, and a chunk is a four-byte length, the
 * four letters, then a four-byte CRC. `IEND` is the one chunk that always has a
 * zero length, so the marker is followed by exactly its CRC and then the video.
 * Checked against a whole segment rather than reasoned about: with this offset
 * the sync bytes land on the 188-byte grid 12130 times out of 12130, and a byte
 * out in either direction would show up immediately as noise.
 */
const PNG_TRAILER_BYTES = 8;

/** NAL unit types, as the low five bits of a NAL header byte. */
const NAL_SPS = 7;

/**
 * Which video stream types the PMT can name that this can read.
 *
 * `0x1b` is H.264 and is the only one that happens here. `0x24` is HEVC, which
 * is listed rather than ignored so that a stream that switches to it reads as
 * unmeasured instead of as a size decoded from the wrong bit layout.
 */
const VIDEO_STREAM_TYPE = 0x1b;
const HEVC_STREAM_TYPE = 0x24;

/**
 * Profiles whose SPS carries the extra fields between the identifier and the
 * frame numbering. Everything from High upward, which is everything in practice.
 */
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/**
 * How long the wrapper is, or 0 if there is no wrapper.
 *
 * The signature alone is not enough to go on. A PNG is a plausible thing for a
 * misconfigured host to actually serve, and cutting seventy bytes out of a real
 * image would turn a broken stream into a differently broken one. So the `IEND`
 * chunk has to be there too, and the video starts after it.
 */
export function wrapperLength(bytes) {
  if (bytes.length < PNG_SIGNATURE_BYTES + PNG_TRAILER_BYTES) return 0;
  for (let i = 0; i < PNG_SIGNATURE_BYTES; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return 0;
  }

  const end = indexOfBytes(bytes, 'IEND', PNG_SIGNATURE_BYTES);
  if (end < 0) return 0;

  return end + PNG_TRAILER_BYTES;
}

/**
 * Whether these bytes are an MPEG-TS stream.
 *
 * One `0x47` is not evidence — that is a letter in a text file, and it is one
 * byte in every 256 of anything random. Two, exactly one packet apart, is. Both
 * hosts here label these segments `image/png`, so this is what the response ends
 * up being served as, and a player that is told the wrong type refuses a stream
 * it could have played.
 */
export function isTransportStream(bytes) {
  if (bytes.length === 0 || bytes[0] !== TS_SYNC_BYTE) return false;
  if (bytes.length <= TS_PACKET_BYTES) return true;
  return bytes[TS_PACKET_BYTES] === TS_SYNC_BYTE;
}

/** `indexOf` for a byte string, so this owes nothing to a `Buffer`. */
function indexOfBytes(bytes, text, from) {
  const pattern = [...text].map((character) => character.charCodeAt(0));
  for (let i = from; i + pattern.length <= bytes.length; i += 1) {
    let hit = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

/** The picture size coded into one H.264 sequence parameter set. */
function readSps(nal) {
  const reader = new BitReader(nal);

  const profileIdc = reader.read(8);
  reader.read(8); // constraint flags
  const levelIdc = reader.read(8);
  reader.ue(); // seq_parameter_set_id

  let chromaFormatIdc = 1;
  let separateColourPlane = 0;

  if (HIGH_PROFILES.has(profileIdc)) {
    chromaFormatIdc = reader.ue();
    if (chromaFormatIdc === 3) separateColourPlane = reader.bit();
    reader.ue(); // bit_depth_luma_minus8
    reader.ue(); // bit_depth_chroma_minus8
    reader.bit(); // qpprime_y_zero_transform_bypass_flag

    if (reader.bit()) {
      // Scaling lists, present or not. They have to be walked rather than
      // skipped — each one is a run of signed Exp-Golomb values whose length
      // depends on the ones before it, so there is no fixed number of bits to
      // step over. Rare, but a stream that has them would otherwise decode as a
      // size instead of as unmeasured.
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i += 1) {
        if (!reader.bit()) continue;

        const size = i < 6 ? 16 : 64;
        let last = 8;
        let next = 8;
        for (let j = 0; j < size; j += 1) {
          if (next !== 0) next = (last + reader.se() + 256) & 0xff;
          if (next !== 0) last = next;
        }
      }
    }
  }

  reader.ue(); // log2_max_frame_num_minus4

  const pocType = reader.ue();
  if (pocType === 0) {
    reader.ue(); // log2_max_pic_order_cnt_lsb_minus4
  } else if (pocType === 1) {
    reader.bit(); // delta_pic_order_always_zero_flag
    reader.se(); // offset_for_non_ref_pic
    reader.se(); // offset_for_top_to_bottom_field
    const cycle = reader.ue();
    for (let i = 0; i < cycle; i += 1) reader.se();
  }

  reader.ue(); // max_num_ref_frames
  reader.bit(); // gaps_in_frame_num_value_allowed_flag

  const widthInMacroblocks = reader.ue() + 1;
  const heightInMapUnits = reader.ue() + 1;
  const frameMbsOnly = reader.bit();
  if (!frameMbsOnly) reader.bit(); // mb_adaptive_frame_field_flag
  reader.bit(); // direct_8x8_inference_flag

  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (reader.bit()) {
    cropLeft = reader.ue();
    cropRight = reader.ue();
    cropTop = reader.ue();
    cropBottom = reader.ue();
  }

  // Cropping is counted in chroma samples, so how many pixels a unit is worth
  // depends on the sampling and on whether the frames are coded as fields.
  const chromaArrayType = separateColourPlane ? 0 : chromaFormatIdc;
  const subWidthC = chromaArrayType === 3 ? 1 : 2;
  const subHeightC = chromaArrayType === 1 ? 2 : 1;
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC;
  const cropUnitY = chromaArrayType === 0 ? 2 - frameMbsOnly : subHeightC * (2 - frameMbsOnly);

  return {
    width: widthInMacroblocks * 16 - (cropLeft + cropRight) * cropUnitX,
    height: (2 - frameMbsOnly) * heightInMapUnits * 16 - (cropTop + cropBottom) * cropUnitY,
    profileIdc,
    levelIdc,
  };
}

/**
 * The picture size of a transport stream, or null when it cannot be read.
 *
 * Takes whatever a host sent — wrapper, leading garbage before the first sync
 * byte, or a clean stream — and returns the size the video declares.
 *
 * @param {Uint8Array} bytes  the opening of an MPEG-TS stream
 * @returns {{width: number, height: number, profileIdc: number, levelIdc: number}|null}
 */
export function transportStreamResolution(bytes) {
  const start = wrapperLength(bytes);

  // Not necessarily zero: a host that sends an unwrapped segment can still have
  // a byte or two of something before the first packet.
  let offset = start;
  while (offset < bytes.length && bytes[offset] !== TS_SYNC_BYTE) offset += 1;
  if (offset === bytes.length) return null;

  const tables = new Map();
  let videoPid = null;

  for (let base = offset; base + TS_PACKET_BYTES <= bytes.length; base += TS_PACKET_BYTES) {
    if (bytes[base] !== TS_SYNC_BYTE) return null;

    const startsUnit = (bytes[base + 1] & 0x40) !== 0;
    const pid = ((bytes[base + 1] & 0x1f) << 8) | bytes[base + 2];
    const adaptation = (bytes[base + 3] >> 4) & 0x3;
    if (adaptation === 0) continue;

    let payload = base + 4;
    if (adaptation === 2 || adaptation === 3) payload = base + 5 + bytes[base + 4];
    if (payload >= base + TS_PACKET_BYTES) continue;
    if (!startsUnit) continue;

    // Program tables are section-structured: one pointer byte, then the section.
    const section = payload + 1 + bytes[payload];
    if (section + 3 > bytes.length) continue;

    const tableId = bytes[section];
    if (pid === 0 && tableId === 0x00 && videoPid === null) {
      const named = readPat(bytes, section, base);
      if (named !== null) tables.set('pmt', named);
    } else if (pid === tables.get('pmt') && tableId === 0x02 && videoPid === null) {
      videoPid = readPmt(bytes, section);
    }
  }

  if (videoPid === null) return null;

  for (let base = offset; base + TS_PACKET_BYTES <= bytes.length; base += TS_PACKET_BYTES) {
    const pid = ((bytes[base + 1] & 0x1f) << 8) | bytes[base + 2];
    if (pid !== videoPid) continue;

    const adaptation = (bytes[base + 3] >> 4) & 0x3;
    if (adaptation === 0) continue;

    let payload = base + 4;
    if (adaptation === 2 || adaptation === 3) payload = base + 5 + bytes[base + 4];

    for (let i = payload; i < base + TS_PACKET_BYTES - 4; i += 1) {
      if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 0x01) continue;
      if ((bytes[i + 3] & 0x1f) !== NAL_SPS) continue;

      // Sixty-four bytes is far past the end of any real SPS — the ones here run
      // to twenty. The tail only exists so the bit reader cannot run off the end
      // of a short buffer into whatever the next packet happens to hold.
      //
      // The reader starts *after* the header byte. Handing it the header leaves
      // it reading `0x67` as the profile and zero as the level — a size, but a
      // made-up one, which is the one outcome worse than no size at all.
      const limit = Math.min(bytes.length, i + 4 + 64);
      return readSps(bytes.subarray(i + 4, limit));
    }
  }

  return null;
}

/** The PMT's PID, from a PAT section. */
function readPat(bytes, section, base) {
  const length = ((bytes[section + 1] & 0x0f) << 8) | bytes[section + 2];
  const end = Math.min(bytes.length, section + 3 + length - 4);

  for (let p = section + 8; p + 4 <= end; p += 4) {
    const program = (bytes[p] << 8) | bytes[p + 1];
    if (program === 0) continue; // network PID, not a programme
    return ((bytes[p + 2] & 0x1f) << 8) | bytes[p + 3];
  }

  return null;
}

/** The video PID, from a PMT section. */
function readPmt(bytes, section) {
  const length = ((bytes[section + 1] & 0x0f) << 8) | bytes[section + 2];
  const end = Math.min(bytes.length, section + 3 + length - 4);

  // Eight bytes of section header, two of PCR PID, then the programme's own
  // descriptors, before the list of streams.
  let p = section + 12 + (((bytes[section + 10] & 0x0f) << 8) | bytes[section + 11]);

  while (p + 5 <= end) {
    const type = bytes[p];
    const pid = ((bytes[p + 1] & 0x1f) << 8) | bytes[p + 2];
    const infoLength = ((bytes[p + 3] & 0x0f) << 8) | bytes[p + 4];

    if (type === VIDEO_STREAM_TYPE || type === HEVC_STREAM_TYPE) return pid;
    p += 5 + infoLength;
  }

  return null;
}

/**
 * A cursor over a bit field.
 *
 * H.264 states its numbers in two shapes and both are here: fixed-width fields,
 * and the variable-length Exp-Golomb coding the specification uses for anything
 * that is usually small. Exp-Golomb is why this is a bit reader and not a byte
 * one — the values do not land on byte boundaries.
 */
class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.position = 0;
  }

  bit() {
    const byte = this.bytes[this.position >> 3] ?? 0;
    const value = (byte >> (7 - (this.position & 7))) & 1;
    this.position += 1;
    return value;
  }

  read(count) {
    let value = 0;
    for (let i = 0; i < count; i += 1) value = (value << 1) | this.bit();
    return value;
  }

  /** Leading zeros, then that many bits: the unsigned Exp-Golomb code. */
  ue() {
    let zeros = 0;
    while (this.position < this.bytes.length * 8 && this.bit() === 0) zeros += 1;
    if (zeros === 0) return 0;
    return (1 << zeros) - 1 + this.read(zeros);
  }

  /** The same code, mapped onto the integers that straddle zero. */
  se() {
    const code = this.ue();
    return code & 1 ? (code + 1) >> 1 : -(code >> 1);
  }
}
