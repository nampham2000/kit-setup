using UnityEngine;
using UnityEngine.UI;

namespace GameA.Runner
{
    public class PlayerRunner : MonoBehaviour
    {
        [SerializeField] private float forwardSpeed = 8f;
        [SerializeField] private float laneWidth = 2f;
        [SerializeField] private Text scoreText;

        private int currentLane = 0; // -1: Left, 0: Mid, 1: Right
        private int score = 0;
        private bool isRunning = false;

        private void Start()
        {
            isRunning = true;
            UpdateScoreUI();
        }

        private void Update()
        {
            if (!isRunning) return;

            // Forward movement
            transform.position += Vector3.forward * forwardSpeed * Time.deltaTime;

            // Lane steering
            if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A))
            {
                ChangeLane(-1);
            }
            else if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D))
            {
                ChangeLane(1);
            }

            // Target lane position interpolation
            Vector3 targetPos = new Vector3(currentLane * laneWidth, transform.position.y, transform.position.z);
            transform.position = Vector3.MoveTowards(transform.position, targetPos, 15f * Time.deltaTime);
        }

        public void ChangeLane(int direction)
        {
            currentLane = Mathf.Clamp(currentLane + direction, -1, 1);
        }

        public void AddScore(int amount)
        {
            score += amount;
            UpdateScoreUI();
        }

        private void UpdateScoreUI()
        {
            if (scoreText != null)
            {
                scoreText.text = $"Score: {score}";
            }
        }
    }
}
