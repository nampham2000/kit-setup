using System;using System.IO;using System.Collections.Generic;using UnityEngine;using UnityEngine.SceneManagement;using UnityEditor.SceneManagement;
public class FloorContactObserver:MonoBehaviour {
 public List<object> events=new List<object>(); public int step;
 void Record(Collision c,string phase){var p=c.contactCount>0?c.GetContact(0):default(ContactPoint);events.Add(new{step,phase,contacts=c.contactCount,position=new[]{transform.position.x,transform.position.y,transform.position.z},point=new[]{p.point.x,p.point.y,p.point.z},separation=p.separation});}
 void OnCollisionEnter(Collision c){Record(c,"enter");} void OnCollisionStay(Collision c){Record(c,"stay");}void OnCollisionExit(Collision c){Record(c,"exit");}
}

