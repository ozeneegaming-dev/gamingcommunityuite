package vmath

import (
	"math"
	"math/rand"
	"testing"
)

func near(a, b, eps float64) bool { return math.Abs(a-b) <= eps }

func sameRot(t *testing.T, a, b Mat3) {
	t.Helper()
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if !near(a[i][j], b[i][j], 1e-9) {
				t.Fatalf("rotations differ:\n%v\n%v", a, b)
			}
		}
	}
}

// The engine builds bone rotations with AngleQuaternion; our inverse must round-trip through it exactly.
func TestQuaternionAnglesRoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	for i := 0; i < 2000; i++ {
		q := Quat{r.NormFloat64(), r.NormFloat64(), r.NormFloat64(), r.NormFloat64()}.Normalize()
		back := AngleQuaternion(QuaternionAngles(q))
		sameRot(t, QuatMat3(q), QuatMat3(back))
	}
	// Gimbal lock (pitch = ±90°).
	for _, a := range []Vec3{{0.3, math.Pi / 2, -1.1}, {-2, -math.Pi / 2, 0.4}} {
		q := AngleQuaternion(a)
		sameRot(t, QuatMat3(q), QuatMat3(AngleQuaternion(QuaternionAngles(q))))
	}
}

// AngleQuaternion is Rz(yaw)·Ry(pitch)·Rx(roll).
func TestAngleOrder(t *testing.T) {
	a := Vec3{0.2, -0.7, 1.3}
	rx := QuatMat3(Quat{math.Sin(a[0] / 2), 0, 0, math.Cos(a[0] / 2)})
	ry := QuatMat3(Quat{0, math.Sin(a[1] / 2), 0, math.Cos(a[1] / 2)})
	rz := QuatMat3(Quat{0, 0, math.Sin(a[2] / 2), math.Cos(a[2] / 2)})
	sameRot(t, QuatMat3(AngleQuaternion(a)), rz.Mul(ry).Mul(rx))
}

func TestMat4InverseAndQuat(t *testing.T) {
	m := TRS(Vec3{1, 2, 3}, Quat{0.1, 0.7, -0.2, 0.6}, Vec3{2, 2, 2})
	id := m.Mul(m.Inverse())
	for i, v := range Mat4Identity() {
		if !near(id[i], v, 1e-9) {
			t.Fatalf("inverse wrong: %v", id)
		}
	}
	q := Quat{0.1, 0.7, -0.2, 0.6}.Normalize()
	sameRot(t, QuatMat3(q), QuatMat3(Mat3Quat(QuatMat3(q))))
	b := BoneFromPosAngles(Vec3{1, 2, 3}, Vec3{0.4, 0.1, -0.3})
	p := Vec3{5, -1, 2}
	back := b.Inverse().Apply(b.Apply(p))
	if !near(back[0], p[0], 1e-9) || !near(back[1], p[1], 1e-9) || !near(back[2], p[2], 1e-9) {
		t.Fatalf("bone inverse wrong: %v", back)
	}
}
