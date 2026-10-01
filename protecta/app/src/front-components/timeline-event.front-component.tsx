import { useEffect, useState } from 'react';
import { coreGraphQlClient } from 'src/lib/core-client';
import { defineFrontComponent } from 'twenty-sdk/define';
import { useTimelineActivityId } from 'twenty-sdk/front-component';
import { FC_TIMELINE_EVENT } from 'src/constants/universal-identifiers';
const Component = () => {
  const id = useTimelineActivityId();
  const [properties, setProperties] = useState<Record<string, unknown>>({});
  useEffect(() => {
    let active = true;
    if (id)
      coreGraphQlClient({ runAs: 'user' })
        .query({
          timelineActivities: {
            __args: { filter: { id: { eq: id } }, first: 1 },
            edges: { node: { properties: true } },
          },
        })
        .then((result: any) => {
          if (active)
            setProperties(
              result.timelineActivities?.edges?.[0]?.node?.properties ?? {},
            );
        })
        .catch(() => {
          if (active)
            setProperties({ message: 'Activity details unavailable.' });
        });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <div>
      <strong>Protecta Bode</strong>
      <dl>
        {Object.entries(properties).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
export default defineFrontComponent({
  universalIdentifier: FC_TIMELINE_EVENT,
  name: 'protecta-timeline-event',
  component: Component,
});
