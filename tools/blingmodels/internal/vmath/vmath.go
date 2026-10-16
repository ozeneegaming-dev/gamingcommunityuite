// Package vmath has the small linear algebra the converter needs: vectors, quaternions, 3x4 bone matrices and the
// exact Euler convention of the GoldSrc engine (AngleQuaternion / QuaternionMatrix from the Half-Life SDK mathlib).
package vmath

import "math"

type Vec3 [3]float64

func (a Vec3) Add(b Vec3) Vec3      { return Vec3{a[0] + b[0], a[1] + b[1], a[2] + b[2]} }
func (a Vec3) Sub(b Vec3) Vec3      { return Vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a Vec3) Scale(s float64) Vec3 { return Vec3{a[0] * s, a[1] * s, a[2] * s} }
func (a Vec3) Dot(b Vec3) float64   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func (a Vec3) Cross(b Vec3) Vec3 {
	return Vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
func (a Vec3) Len() float64 { return math.Sqrt(a.Dot(a)) }
func (a Vec3) Norm() Vec3 {
	l := a.Len()
	if l < 1e-12 {
		return Vec3{0, 0, 1}
	}
	return a.Scale(1 / l)
}
func (a Vec3) Min(b Vec3) Vec3 {
	return Vec3{math.Min(a[0], b[0]), math.Min(a[1], b[1]), math.Min(a[2], b[2])}
}
func (a Vec3) Max(b Vec3) Vec3 {
	return Vec3{math.Max(a[0], b[0]), math.Max(a[1], b[1]), math.Max(a[2], b[2])}
}

// Quat is (x, y, z, w), like the SDK's vec4_t quaternions.
type Quat [4]float64

func QuatIdentity() Quat { return Quat{0, 0, 0, 1} }

func (q Quat) Mul(r Quat) Quat {
	return Quat{
		q[3]*r[0] + q[0]*r[3] + q[1]*r[2] - q[2]*r[1],
		q[3]*r[1] - q[0]*r[2] + q[1]*r[3] + q[2]*r[0],
		q[3]*r[2] + q[0]*r[1] - q[1]*r[0] + q[2]*r[3],
		q[3]*r[3] - q[0]*r[0] - q[1]*r[1] - q[2]*r[2],
	}
}

func (q Quat) Normalize() Quat {
	l := math.Sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3])
	if l < 1e-12 {
		return QuatIdentity()
	}
	return Quat{q[0] / l, q[1] / l, q[2] / l, q[3] / l}
}

// Slerp between two rotations (shortest path).
func Slerp(a, b Quat, t float64) Quat {
	dot := a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]
	if dot < 0 {
		b = Quat{-b[0], -b[1], -b[2], -b[3]}
		dot = -dot
	}
	if dot > 0.9995 {
		return Quat{a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t, a[3] + (b[3]-a[3])*t}.Normalize()
	}
	th := math.Acos(dot)
	s := math.Sin(th)
	wa, wb := math.Sin((1-t)*th)/s, math.Sin(t*th)/s
	return Quat{a[0]*wa + b[0]*wb, a[1]*wa + b[1]*wb, a[2]*wa + b[2]*wb, a[3]*wa + b[3]*wb}
}

// AngleQuaternion is the SDK's conversion: angles are rotations (radians) about X, Y and Z.
func AngleQuaternion(a Vec3) Quat {
	sy, cy := math.Sincos(a[2] * 0.5)
	sp, cp := math.Sincos(a[1] * 0.5)
	sr, cr := math.Sincos(a[0] * 0.5)
	return Quat{
		sr*cp*cy - cr*sp*sy,
		cr*sp*cy + sr*cp*sy,
		cr*cp*sy - sr*sp*cy,
		cr*cp*cy + sr*sp*sy,
	}
}

// QuaternionAngles is the inverse of AngleQuaternion (Z·Y·X order), so engine(AngleQuaternion(QuaternionAngles(q))) == q.
func QuaternionAngles(q Quat) Vec3 {
	m := QuatMat3(q.Normalize())
	// m = Rz(yaw) * Ry(pitch) * Rx(roll)
	sp := -m[2][0]
	if sp > 1 {
		sp = 1
	} else if sp < -1 {
		sp = -1
	}
	pitch := math.Asin(sp)
	var roll, yaw float64
	if math.Abs(sp) < 0.999999 {
		roll = math.Atan2(m[2][1], m[2][2])
		yaw = math.Atan2(m[1][0], m[0][0])
	} else {
		// Gimbal lock: put everything in yaw.
		roll = 0
		yaw = math.Atan2(-m[0][1], m[1][1])
	}
	return Vec3{roll, pitch, yaw}
}

// Mat3 is row-major: m[row][col].
type Mat3 [3][3]float64

// QuatMat3 is the SDK's QuaternionMatrix (rotation part).
func QuatMat3(q Quat) Mat3 {
	x, y, z, w := q[0], q[1], q[2], q[3]
	return Mat3{
		{1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y},
		{2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x},
		{2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y},
	}
}

func (m Mat3) MulVec(v Vec3) Vec3 {
	return Vec3{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}

func (m Mat3) Mul(n Mat3) Mat3 {
	var r Mat3
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			r[i][j] = m[i][0]*n[0][j] + m[i][1]*n[1][j] + m[i][2]*n[2][j]
		}
	}
	return r
}

func (m Mat3) Transpose() Mat3 {
	return Mat3{{m[0][0], m[1][0], m[2][0]}, {m[0][1], m[1][1], m[2][1]}, {m[0][2], m[1][2], m[2][2]}}
}

// Mat3Quat converts an orthonormal rotation matrix to a quaternion.
func Mat3Quat(m Mat3) Quat {
	tr := m[0][0] + m[1][1] + m[2][2]
	var q Quat
	switch {
	case tr > 0:
		s := math.Sqrt(tr+1) * 2
		q = Quat{(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s}
	case m[0][0] > m[1][1] && m[0][0] > m[2][2]:
		s := math.Sqrt(1+m[0][0]-m[1][1]-m[2][2]) * 2
		q = Quat{0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s}
	case m[1][1] > m[2][2]:
		s := math.Sqrt(1+m[1][1]-m[0][0]-m[2][2]) * 2
		q = Quat{(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s}
	default:
		s := math.Sqrt(1+m[2][2]-m[0][0]-m[1][1]) * 2
		q = Quat{(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s}
	}
	return q.Normalize()
}

// Orthonormalize removes scale and shear from a rotation-ish matrix (Gram-Schmidt on the columns).
func Orthonormalize(m Mat3) Mat3 {
	c0 := Vec3{m[0][0], m[1][0], m[2][0]}.Norm()
	c1 := Vec3{m[0][1], m[1][1], m[2][1]}
	c1 = c1.Sub(c0.Scale(c0.Dot(c1))).Norm()
	c2 := c0.Cross(c1)
	// Keep a mirrored basis as a proper rotation (GoldSrc bones cannot mirror).
	return Mat3{{c0[0], c1[0], c2[0]}, {c0[1], c1[1], c2[1]}, {c0[2], c1[2], c2[2]}}
}

// Bone is a rigid transform (rotation + translation), the engine's 3x4 bone matrix.
type Bone struct {
	R Mat3
	T Vec3
}

func BoneIdentity() Bone { return Bone{R: Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}} }

// BoneFromPosAngles is the engine's local bone matrix from the six bone values (position + Euler angles).
func BoneFromPosAngles(pos, ang Vec3) Bone { return Bone{R: QuatMat3(AngleQuaternion(ang)), T: pos} }

func (a Bone) Mul(b Bone) Bone         { return Bone{R: a.R.Mul(b.R), T: a.R.MulVec(b.T).Add(a.T)} }
func (a Bone) Apply(v Vec3) Vec3       { return a.R.MulVec(v).Add(a.T) }
func (a Bone) Rotate(v Vec3) Vec3      { return a.R.MulVec(v) }
func (a Bone) Inverse() Bone           { rt := a.R.Transpose(); return Bone{R: rt, T: rt.MulVec(a.T).Scale(-1)} }
func (a Bone) PosAngles() (Vec3, Vec3) { return a.T, QuaternionAngles(Mat3Quat(a.R)) }

// Mat4 is a column-major 4x4 matrix (glTF layout).
type Mat4 [16]float64

func Mat4Identity() Mat4 { return Mat4{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1} }

func (a Mat4) Mul(b Mat4) Mat4 {
	var r Mat4
	for c := 0; c < 4; c++ {
		for rr := 0; rr < 4; rr++ {
			var s float64
			for k := 0; k < 4; k++ {
				s += a[k*4+rr] * b[c*4+k]
			}
			r[c*4+rr] = s
		}
	}
	return r
}

func (a Mat4) Apply(v Vec3) Vec3 {
	return Vec3{
		a[0]*v[0] + a[4]*v[1] + a[8]*v[2] + a[12],
		a[1]*v[0] + a[5]*v[1] + a[9]*v[2] + a[13],
		a[2]*v[0] + a[6]*v[1] + a[10]*v[2] + a[14],
	}
}

func (a Mat4) ApplyDir(v Vec3) Vec3 {
	return Vec3{a[0]*v[0] + a[4]*v[1] + a[8]*v[2], a[1]*v[0] + a[5]*v[1] + a[9]*v[2], a[2]*v[0] + a[6]*v[1] + a[10]*v[2]}
}

// Rot3 is the upper-left 3x3 block (row-major Mat3).
func (a Mat4) Rot3() Mat3 {
	return Mat3{{a[0], a[4], a[8]}, {a[1], a[5], a[9]}, {a[2], a[6], a[10]}}
}

func (a Mat4) Translation() Vec3 { return Vec3{a[12], a[13], a[14]} }

// Det3 is the determinant of the 3x3 block (negative = mirrored).
func (a Mat4) Det3() float64 {
	m := a.Rot3()
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
}

// Inverse of a general affine 4x4 (last row 0 0 0 1).
func (a Mat4) Inverse() Mat4 {
	m := a.Rot3()
	det := a.Det3()
	if math.Abs(det) < 1e-20 {
		return Mat4Identity()
	}
	inv := Mat3{
		{(m[1][1]*m[2][2] - m[1][2]*m[2][1]) / det, (m[0][2]*m[2][1] - m[0][1]*m[2][2]) / det, (m[0][1]*m[1][2] - m[0][2]*m[1][1]) / det},
		{(m[1][2]*m[2][0] - m[1][0]*m[2][2]) / det, (m[0][0]*m[2][2] - m[0][2]*m[2][0]) / det, (m[0][2]*m[1][0] - m[0][0]*m[1][2]) / det},
		{(m[1][0]*m[2][1] - m[1][1]*m[2][0]) / det, (m[0][1]*m[2][0] - m[0][0]*m[2][1]) / det, (m[0][0]*m[1][1] - m[0][1]*m[1][0]) / det},
	}
	t := inv.MulVec(a.Translation()).Scale(-1)
	return Mat4{inv[0][0], inv[1][0], inv[2][0], 0, inv[0][1], inv[1][1], inv[2][1], 0, inv[0][2], inv[1][2], inv[2][2], 0, t[0], t[1], t[2], 1}
}

// TRS builds a glTF node matrix from translation, rotation (x,y,z,w) and scale.
func TRS(t Vec3, r Quat, s Vec3) Mat4 {
	m := QuatMat3(r.Normalize())
	return Mat4{
		m[0][0] * s[0], m[1][0] * s[0], m[2][0] * s[0], 0,
		m[0][1] * s[1], m[1][1] * s[1], m[2][1] * s[1], 0,
		m[0][2] * s[2], m[1][2] * s[2], m[2][2] * s[2], 0,
		t[0], t[1], t[2], 1,
	}
}

// NormalMatrix transforms normals for a possibly scaled matrix (inverse transpose of the 3x3 block).
func (a Mat4) NormalMatrix() Mat3 {
	return a.Inverse().Rot3().Transpose()
}
