package mdl

// The animation value streams (mstudioanimvalue_t): a run header {valid, total} (two bytes) followed by `valid`
// shorts. Frames 0..valid-1 of the run use their own value; frames valid..total-1 repeat the last valid value. This is
// exactly how the engine reads them (StudioCalcBoneAdj / StudioCalcBonePosition in the SDK).

// DecodeAnimValues expands a stream (as 16-bit words) to one value per frame.
func DecodeAnimValues(words []uint16, numFrames int) ([]int16, bool) {
	out := make([]int16, numFrames)
	p := 0
	run := 0 // first frame of the current run
	for f := 0; f < numFrames; f++ {
		for {
			if p >= len(words) {
				return nil, false
			}
			valid := int(words[p] & 0xff)
			total := int(words[p] >> 8)
			if total == 0 {
				return nil, false
			}
			if f-run < total {
				k := f - run
				var idx int
				if k < valid {
					idx = p + 1 + k
				} else {
					idx = p + valid
				}
				if idx >= len(words) || valid == 0 && idx == p {
					return nil, false
				}
				out[f] = int16(words[idx])
				break
			}
			run += total
			p += valid + 1
		}
	}
	return out, true
}

// AnimStreamLen is the number of words a stream occupies for numFrames frames (to copy or skip it).
func AnimStreamLen(words []uint16, numFrames int) int {
	p, covered := 0, 0
	for covered < numFrames && p < len(words) {
		valid := int(words[p] & 0xff)
		total := int(words[p] >> 8)
		if total == 0 {
			break
		}
		covered += total
		p += valid + 1
	}
	return p
}

// EncodeAnimValues compresses one value per frame into a stream; nil for an all-zero channel (offset 0).
func EncodeAnimValues(v []int16) []uint16 {
	zero := true
	for _, x := range v {
		if x != 0 {
			zero = false
			break
		}
	}
	if zero || len(v) == 0 {
		return nil
	}
	var out []uint16
	n := len(v)
	for i := 0; i < n; {
		// Values that change go in the "valid" part; a repeated tail is folded into "total".
		valid := 1
		for i+valid < n && valid < 255 {
			k := i + valid
			if v[k] == v[k-1] {
				// A repeat of at least two frames is cheaper as a tail.
				if k+1 >= n || v[k+1] == v[k] {
					break
				}
			}
			valid++
		}
		total := valid
		last := v[i+valid-1]
		for i+total < n && total < 255 && v[i+total] == last {
			total++
		}
		out = append(out, uint16(valid)|uint16(total)<<8)
		for k := 0; k < valid; k++ {
			out = append(out, uint16(v[i+k]))
		}
		i += total
	}
	return out
}
