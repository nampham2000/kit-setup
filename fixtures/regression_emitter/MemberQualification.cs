using UnityEngine;

public class MemberQualification : MonoBehaviour
{
    private int count = 5;
    private int i = 99;
    private float speed = 1f;
    private static int Total = 0;
    private static int Bump() { return Total + 1; }

    private int Doubled => count * 2;
    public int Tripled { get { return count * 3; } }

    void Update()
    {
        Helper();                       // own method -> this.
        int a = Doubled + Tripled;      // properties -> this.
        for (int i = 0; i < count; i++) // loop var shadows field `i`
        {
            a += i;
        }
        foreach (var speed in new int[] { 1, 2 })  // foreach shadows field `speed`
        {
            a += speed;
        }
        Total = Bump();                 // statics -> MemberQualification.
        Debug.Log($"count={count} lit=\"count\" m={Helper2()}");
    }

    private void Helper() { }
    private int Helper2() { return count; }
    private void Shadow(int count) { Debug.Log(count); }  // param shadows field
}
