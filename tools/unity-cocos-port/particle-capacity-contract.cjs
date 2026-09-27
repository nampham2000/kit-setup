'use strict';
// Event-bearing modules require separate death/callback-order evidence.
function capacityRetirementEligible(source){return !source.SubModule?.enabled&&!source.CollisionModule?.enabled&&!source.TrailModule?.enabled&&!source.TriggerModule?.enabled;}
module.exports={capacityRetirementEligible};
