using System.Collections;
using UnityEngine;

namespace GameC.Idle
{
    public enum GameState
    {
        Idle,
        Working,
        Paused,
        Complete
    }

    public class IdleManager : MonoBehaviour
    {
        [SerializeField] private float harvestInterval = 2.0f;
        [SerializeField] private int baseRevenue = 10;

        private GameState currentState = GameState.Idle;
        private int totalCoins = 0;

        private void Start()
        {
            totalCoins = PlayerPrefs.GetInt("COINS_SAVED", 0);
            StartCoroutine(HarvestRoutine());
        }

        private IEnumerator HarvestRoutine()
        {
            while (true)
            {
                if (currentState == GameState.Working)
                {
                    totalCoins += baseRevenue;
                    PlayerPrefs.SetInt("COINS_SAVED", totalCoins);
                }
                yield return new WaitForSeconds(harvestInterval);
            }
        }

        public void SetState(GameState newState)
        {
            currentState = newState;
        }

        public int GetTotalCoins()
        {
            return totalCoins;
        }
    }
}
