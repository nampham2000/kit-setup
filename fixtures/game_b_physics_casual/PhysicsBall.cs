using UnityEngine;

namespace GameB.PhysicsPlatformer
{
    public class PhysicsBall : MonoBehaviour
    {
        [SerializeField] private float jumpForce = 12f;
        [SerializeField] private float raycastDistance = 0.6f;
        [SerializeField] private LayerMask groundLayer;

        private Rigidbody rb;
        private bool isGrounded = false;

        private void Awake()
        {
            rb = GetComponent<Rigidbody>();
        }

        private void Update()
        {
            CheckGrounded();

            if (Input.GetKeyDown(KeyCode.Space) && isGrounded)
            {
                Jump();
            }
        }

        private void CheckGrounded()
        {
            isGrounded = Physics.Raycast(transform.position, Vector3.down, raycastDistance, groundLayer);
        }

        private void Jump()
        {
            if (rb != null)
            {
                rb.AddForce(Vector3.up * jumpForce, ForceMode.Impulse);
            }
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other.CompareTag("Hazard"))
            {
                Debug.Log("Hit Hazard!");
            }
        }
    }
}
