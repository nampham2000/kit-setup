using UnityEngine;

public class ScalarAndVectorMath : MonoBehaviour
{
    private int groupCount = 2;
    private int upgradeLevel = 3;
    private float brightness = 0.5f;
    private float scaleFactor = 2f;

    private int TouchCount => 1;
    private float Doubled => scaleFactor * 2f;

    void Update()
    {
        // B1: identifiers merely CONTAINING "up" / "right" / "scale" / "position"
        int total = groupCount + upgradeLevel;
        float lit = brightness + 0.25f;
        float sc = scaleFactor + 1f;

        // B2: scalar arithmetic on .x/.y components of a real vector
        float px = transform.position.x + 1f;

        // C: two live Vec3 temporaries in sequence (aliasing)
        Vector3 a = transform.position - Vector3.one;
        Vector3 b = transform.position + Vector3.one;
        Vector3 sum = a + b;

        // A: calling own method + own property from a method
        Helper();
        int t = TouchCount + total;
        float d = Doubled + lit + sc + px + sum.x;
        Debug.Log(d + t);
    }

    private void Helper() { }
}
