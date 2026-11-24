import {ManageBooking} from '../../features/live/manage-booking';
import {demoEnabled,websiteUrl} from '../../lib/config';
export const dynamic='force-dynamic';
export default function Page(){return <ManageBooking websiteUrl={websiteUrl} demo={demoEnabled}/>;}
